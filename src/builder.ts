/**
 * @file The release builder: one feed in, one cutover out.
 *
 * Everything the site serves is derived from one download of the GTFS feed —
 * the pages, the map, the schedule the worker reads — and it all becomes live
 * in a single rename. The app and the map cannot disagree about which feed they
 * were built from, because there is only one, and they land together.
 *
 *   download → normalise → (pages ‖ map) → seed → flip
 *
 * The whole of it is sequential code with `try`/`catch`, not a workflow engine.
 * A step that throws means `publish` is never reached, so the previous release
 * stays live: a failed build is invisible to riders and visible in the
 * heartbeat.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import unzipper from "unzipper";

import { GPMETRO } from "@/lib/constants";
import { writeStaticFeed } from "@/lib/feed/artifact";
import { ARRIVALS_LIMIT } from "@/lib/feed/expand";
import { normalizeFeed } from "@/lib/feed/normalize";
import { TransitStore } from "@/lib/feed/store";
import { GTFSStatic } from "@/lib/gtfs/static";
import { Manifest, Releases } from "@/lib/release";
import { renderArrivals } from "../public/js/render-arrivals.js";

const run = promisify(execFile);

/**
 * Puts a directory's contents in place, by hardlink where it can.
 *
 * The map bundle is 124 MB and every release sharing a feed shares those bytes
 * exactly, so copying would spend a third of a gigabyte saying the same thing
 * three times. Linking needs the files to be ours, though — Linux refuses a
 * hardlink to a file you do not own — and a bundle built by a container running
 * as root is not. Copying is the fallback, and only costs disk.
 */
async function link(from: string, to: string): Promise<void> {
  try {
    await run("cp", ["-al", `${from}/.`, to]);
  } catch {
    // A failed link pass leaves some files behind, and copying onto its own
    // hardlink is an error, so start from nothing. Not `cp -a` either: that
    // tries to preserve ownership and fails for the same reason as the link.
    console.log("[build] could not hardlink the map bundle; copying it");
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true });
  }
}

/**
 * Puts a map bundle into the release, minus the pipeline's own entry point.
 *
 * `tiles/out/web` is a complete static site on purpose — `tiles/serve.py`
 * serves it directly, which is how the map is developed without building a
 * release. That entry point is a bare MapLibre harness that loads its
 * libraries from unpkg, and a release has no use for it: the site's map is
 * `/by-location`, with everything vendored. Left in place it would be a second,
 * unstyled map hanging off `/tiles/` on the public site.
 */
async function linkBundle(from: string, to: string): Promise<void> {
  await link(from, to);
  await rm(join(to, "index.html"), { force: true });
}

const releasesDir = process.env.RELEASES_DIR ?? "releases";
const dataDir = process.env.DATA_DIR ?? "_data";
const tilesWorkDir = process.env.TILES_WORK_DIR ?? "tiles/out";

/**
 * The feed, downloaded once.
 *
 * Both halves read these bytes — the normaliser through an extracted copy, the
 * tile pipeline as the zip — so nothing downstream can be built from a
 * different snapshot of the world. The id is a hash of the contents rather than
 * an ETag, so it means the same thing wherever the build runs.
 */
async function fetchFeed(
  workDir: string
): Promise<{ zip: string; hash: string; dir: string }> {
  const zip = join(workDir, "gtfs.zip");
  const response = await fetch(GPMETRO.staticURL);
  if (!response.ok) throw new Error(`feed: HTTP ${response.status}`);
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));

  const digest = createHash("sha256");
  for await (const chunk of createReadStream(zip)) digest.update(chunk);

  const dir = join(workDir, "feed");
  await mkdir(dir, { recursive: true });
  await new Promise((resolve, reject) =>
    createReadStream(zip)
      .pipe(unzipper.Extract({ path: dir }))
      .on("close", resolve)
      .on("error", reject)
  );

  return { zip, hash: digest.digest("hex").slice(0, 8), dir };
}

/** Pings a stage's heartbeat, if one is configured. Never throws. */
async function beat(stage: string, suffix = ""): Promise<void> {
  const base = process.env[`HEARTBEAT_${stage.toUpperCase()}`];
  if (!base) return;
  try {
    await fetch(`${base}${suffix}`);
  } catch {
    // A missed heartbeat is not a reason to fail a build.
  }
}

async function appVersion(): Promise<string> {
  // CI builds from a checkout that may have no git history, and a deploy may
  // want to name its own version.
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const { stdout } = await run("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

/**
 * Builds the pages into the staging directory.
 *
 * Eleventy reads the release's own static.json, so the pages describe the feed
 * this release was built from and nothing else.
 */
async function buildSite(staging: string): Promise<void> {
  const { stdout } = await run(
    "node_modules/.bin/eleventy",
    ["--output", join(staging, "site")],
    { env: { ...process.env, STATIC_FEED: join(staging, "static.json") } }
  );
  console.log(`[build] ${stdout.trim().split("\n").at(-1)}`);
}

/**
 * Builds the map, or reuses the last one.
 *
 * The tile pipeline is slow and depends only on the feed, so a release that
 * carries the same feed as the previous one links to its bundle rather than
 * spending minutes reproducing it — which is the common case when a template
 * change triggers the build.
 */
async function buildTiles(
  staging: string,
  releases: Releases,
  feedZip: string,
  reusable: string | null
): Promise<void> {
  if (reusable) {
    console.log("[build] same feed as the last release: reusing its map");
    await linkBundle(
      join(releases.path(reusable), "tiles"),
      join(staging, "tiles")
    );
    return;
  }

  /*
   * A bundle someone else built. The pipeline needs Python, a JRE and loom,
   * which the builder image has and a laptop generally does not — and CI wants
   * to prove a release assembles without spending five minutes on a map. Stated
   * explicitly rather than inferred, so a production build that cannot run the
   * pipeline fails instead of quietly shipping a stale map.
   */
  if (process.env.TILES_FROM) {
    console.log(`[build] using the bundle at ${process.env.TILES_FROM}`);
    await linkBundle(process.env.TILES_FROM, join(staging, "tiles"));
    return;
  }

  await beat("tiles", "/start");
  await run("./pipeline.sh", [], {
    cwd: "tiles",
    env: {
      ...process.env,
      OUT: process.env.TILES_OUT ?? "./out",
      // The basemap is a job of its own; a release build must not start one.
      REQUIRE_BASEMAP: "1",
      GTFS_FILE: feedZip,
      // resolve, not join: the staging path is absolute in a container and
      // relative on a laptop, and join would happily make /app/srv/releases/…
      STOP_NAMES: resolve(staging, "stop-names.json"),
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  await linkBundle(join(tilesWorkDir, "web"), join(staging, "tiles"));
  await beat("tiles");
}

/**
 * Fills the release's data directory with the schedule, and its pages with the
 * same rows.
 *
 * Without this a release would be live for up to a second holding nothing a
 * page could read. The worker overwrites all of it on its next tick with the
 * realtime overlay; this is what the timetable alone says.
 */
async function seed(staging: string, store: TransitStore): Promise<void> {
  const now = Date.now();
  const after = now - 10 * 60 * 1000;
  await mkdir(join(staging, "data", "arrivals"), { recursive: true });

  for (const stop of store.stops()) {
    if (!stop.stopCode) continue;
    const arrivals = store.departures(stop.stopId, after, ARRIVALS_LIMIT);
    await writeFile(
      join(staging, "data", "arrivals", `${stop.stopCode}.json`),
      JSON.stringify(arrivals)
    );

    const page = join(staging, "site", "stops", stop.stopCode, "index.html");
    try {
      const html = await readFile(page, "utf8");
      const start = html.indexOf("<!--arrivals:start-->");
      const end = html.indexOf("<!--arrivals:end-->");
      if (start === -1 || end === -1) continue;
      await writeFile(
        page,
        html.slice(0, start + "<!--arrivals:start-->".length) +
          renderArrivals(arrivals, now) +
          html.slice(end)
      );
    } catch {
      // A stop with no page is a stop with no code; nothing to fill in.
    }
  }
  console.log(`[build] seeded ${store.stops().length} stops`);
}

async function build(): Promise<void> {
  await beat("build", "/start");
  const releases = new Releases(releasesDir, dataDir);
  await mkdir(releasesDir, { recursive: true });

  const workDir = await mkdtemp(join(tmpdir(), "release-"));
  let staging: string | null = null;
  try {
    const feedFile = await fetchFeed(workDir);
    const gtfs = GTFSStatic.fromDirectory(feedFile.dir, feedFile.hash);
    if (!(await gtfs.hasRequiredData())) {
      throw new Error("the feed is missing files it must have");
    }

    const version = await appVersion();
    const current = await releases.current();
    const live = current ? await releases.manifest(current) : null;
    if (
      live &&
      live.feedHash === feedFile.hash &&
      live.appVersion === version
    ) {
      console.log(`[build] ${current} is already current`);
      await beat("build");
      return;
    }

    const id = `${new Date().toISOString().slice(0, 10)}-${feedFile.hash}-${version}`;
    console.log(`[build] ${id}`);
    staging = await releases.stage(id);

    const feed = await normalizeFeed(gtfs);
    await writeStaticFeed(join(staging, "static.json"), feed);
    await writeFile(
      join(staging, "stop-names.json"),
      JSON.stringify(
        Object.fromEntries(feed.stops.map((s) => [s.stopId, s.stopName]))
      )
    );
    await releases.writeManifest(staging, {
      feedHash: feedFile.hash,
      appVersion: version,
      builtAt: new Date().toISOString(),
    } satisfies Manifest);

    // The map only depends on the feed, so an unchanged feed keeps its bundle.
    const reusable = live?.feedHash === feedFile.hash ? current : null;
    await Promise.all([
      buildSite(staging),
      buildTiles(staging, releases, feedFile.zip, reusable),
    ]);

    const store = new TransitStore(GPMETRO.timeZone);
    await store.loadStatic(join(staging, "static.json"));
    await seed(staging, store);

    await releases.publish(id);
    const pruned = await releases.prune();
    console.log(
      `[build] ${id} is live` +
        (pruned.length ? `, pruned ${pruned.join(", ")}` : "")
    );
    await beat("build");
  } catch (error) {
    // Nothing was published, so the previous release is still serving. The
    // half-built one goes; everything else is untouched.
    console.error("[build] failed:", error);
    if (staging) await rm(staging, { recursive: true, force: true });
    await beat("build", "/fail");
    process.exitCode = 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

build();
