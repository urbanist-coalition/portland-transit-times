/**
 * Every stylesheet and module the site serves, plus a fingerprint of their
 * contents.
 *
 * The service worker precaches this list, and names its cache after the
 * fingerprint — so adding a file cannot leave it uncached, and deploying a
 * change to any of them retires the old cache on its own. Hand-maintained
 * lists and hand-bumped version constants both drift, and both fail silently.
 */

const { createHash } = require("node:crypto");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..", "public");

/** Small enough to precache, and needed before anything can render. */
const DIRECTORIES = ["css", "js"];
const ALSO = ["site.webmanifest"];

module.exports = function assets() {
  const files = [];
  for (const directory of DIRECTORIES) {
    for (const name of readdirSync(join(ROOT, directory)).sort()) {
      // public/js/package.json is there to tell Node that directory is ESM;
      // the browser has no use for it.
      if (!/\.(css|js)$/.test(name)) continue;
      files.push(`/${directory}/${name}`);
    }
  }

  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(join(ROOT, file.slice(1))));

  return {
    precache: [...files, ...ALSO.map((name) => `/${name}`)],
    version: hash.digest("hex").slice(0, 8),
  };
};
