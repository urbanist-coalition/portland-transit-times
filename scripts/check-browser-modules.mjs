/**
 * @file Prove the browser modules still get off the ground.
 *
 * Node imports two of them — the renderers the worker and the build share — so
 * a mistake there is caught by the tests. Nothing imports the rest. A page
 * script runs only in a browser, which means `tsc`, `jest` and the build all
 * agree a broken one is fine, and the only report comes from a rider looking
 * at times that stopped moving.
 *
 * That is not hypothetical: `arrivals.js` shipped for ten days with a local
 * `poll` alongside the imported one. Two top-level declarations of a name is
 * an early error, so the module never parsed, so nothing in it ran — no
 * polling, no re-render, not even the notice that says the times are old. Every
 * check in this repo stayed green for all six commits it took to notice.
 *
 * So this asks the small question the browser asks first, before types or
 * behaviour or anything else: does the module load?
 *
 *   parse  what a browser rejects before running a line — syntax, and the
 *          early errors like a name declared twice.
 *   link   every named import is a name the other module actually exports, so
 *          a renamed export cannot leave a page dead on "does not provide an
 *          export named".
 *
 * Types are deliberately not the point. `public/js` is a long way from
 * checkJs-clean, and that is a separate piece of work; a module that does not
 * load is a bug of a different kind, and this is the check for it.
 */

import { spawn } from "node:child_process";
import { glob, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything a page loads that we wrote. The vendored MapLibre and PMTiles are
 * not ours to check, and `site/sw.njk` is a template rather than a module — it
 * is not a script until Eleventy has written it.
 */
const SOURCES = ["public/js/*.js", "public/map/*.js"];

/** The directories SOURCES draws from, as the only ones this can speak for. */
const covered = new Set(SOURCES.map((pattern) => join(root, dirname(pattern))));

/**
 * Whether a module is one this check would have read had it been there — which
 * is what separates a typo in an import path from a deliberate reach outside,
 * and is answered from the globs rather than from disk, because some of what
 * lies outside is build output that does not exist yet when this runs.
 */
function covers(file) {
  return covered.has(dirname(file)) && file.endsWith(".js");
}

/** Where the browser looks when a module asks for one. */
function resolveSpecifier(specifier, importer) {
  if (specifier.startsWith("/"))
    return join(root, "public", specifier.slice(1));
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  // A bare specifier has no import map behind it here, so there is nothing to
  // resolve and nothing to check.
  return null;
}

/** The names a module offers, or null if it exports in a way this cannot read. */
function exportedNames(source) {
  const names = new Set();

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      // `export * from "./x.js"` would make this module's surface depend on
      // another's. Nothing does it today; if something starts, say so rather
      // than quietly passing everything.
      if (!statement.exportClause) return null;
      if (!ts.isNamedExports(statement.exportClause)) return null;
      for (const element of statement.exportClause.elements)
        names.add(element.name.text);
      continue;
    }

    const exported = ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    } else if (statement.name) {
      names.add(statement.name.text);
    }
  }

  return names;
}

/** What a module asks of its neighbours: `{ specifier, names }` per import. */
function importedNames(source) {
  const imports = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    const names =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map(
            (element) =>
              // `import { a as b }` asks the other module for `a`.
              (element.propertyName ?? element.name).text
          )
        : [];
    imports.push({ specifier, names });
  }

  return imports;
}

const files = [];
for (const pattern of SOURCES)
  for await (const file of glob(pattern, { cwd: root }))
    files.push(join(root, file));
files.sort();

/**
 * What a real engine says about a module's source, or null if it parses.
 *
 * The source goes in over stdin with the goal stated outright. Handing Node a
 * path instead would let the nearest package.json decide the goal, and for a
 * directory without one — `public/map` — Node parses as CommonJS, falls back
 * when it meets an `import`, and reports nothing at all: syntax errors and
 * duplicate declarations alike pass. A check that answers "fine" for a file it
 * never really read is worse than no check.
 */
function parseFailure(source) {
  return new Promise((resolveWith) => {
    const child = spawn(process.execPath, ["--check", "--input-type=module"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code === 0) return resolveWith(null);
      const message = stderr
        .split("\n")
        .find((line) => line.includes("Error:"));
      resolveWith(message?.trim() ?? "failed to parse");
    });
    child.stdin.end(source);
  });
}

const problems = [];
const show = (file) => relative(root, file);

const sources = new Map(
  await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")])
  )
);

await Promise.all(
  [...sources].map(async ([file, source]) => {
    const failure = await parseFailure(source);
    if (failure) problems.push(`${show(file)}: ${failure}`);
  })
);

// Only worth linking modules that parse: a file that does not is already
// reported, and its exports cannot be read anyway.
if (problems.length === 0) {
  const parsed = new Map(
    [...sources].map(([file, source]) => [
      file,
      ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true),
    ])
  );

  for (const [file, source] of parsed) {
    for (const { specifier, names } of importedNames(source)) {
      const target = resolveSpecifier(specifier, file);
      if (target === null) continue;

      const targetSource = parsed.get(target);
      if (!targetSource) {
        // A module from somewhere this does not cover — the vendored MapLibre
        // under `public/map/vendor`, say — is not ours to read the exports of.
        // Somewhere it does cover, though, means the file is simply not there.
        if (covers(target))
          problems.push(
            `${show(file)}: imports "${specifier}", which does not exist`
          );
        continue;
      }

      const exported = exportedNames(targetSource);
      if (exported === null) continue;

      for (const name of names)
        if (!exported.has(name))
          problems.push(
            `${show(file)}: imports { ${name} } from "${specifier}", which does not export it`
          );
    }
  }
}

if (problems.length > 0) {
  console.error(
    `${problems.length} browser module problem${problems.length === 1 ? "" : "s"}:\n`
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`${files.length} browser modules parse and link.`);
