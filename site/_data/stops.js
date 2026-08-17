/**
 * Every stop, read from the release's static feed.
 *
 * This is the whole reason the site has a build step: stops change when the
 * GTFS feed changes, nightly at most, so their names, codes and route pills
 * belong in the HTML rather than in a payload every visitor downloads.
 *
 * A file rather than a database, which means the build is hermetic — it needs
 * nothing running, so CI can do it and so can a laptop on a train.
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_PATH = join(__dirname, "..", "..", "_data", "static.json");

module.exports = function stops() {
  const path = process.env.STATIC_FEED || DEFAULT_PATH;

  let feed;
  try {
    feed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (process.env.SKIP_STOPS) {
      // A templates-only build: CI proves the site compiles without a feed.
      console.log("[stops] SKIP_STOPS set — building without stop pages");
      return [];
    }
    throw new Error(
      `No static feed at ${path} — run the worker to write one, or set ` +
        `SKIP_STOPS=1 to build without stop pages. (${error.message})`
    );
  }

  const usable = feed.stops
    // The arrivals pages are addressed by stop code; a stop without one cannot
    // have a page, and nothing can link to it.
    .filter((stop) => stop.stopCode)
    .sort((a, b) =>
      a.stopCode.localeCompare(b.stopCode, undefined, { numeric: true })
    );

  console.log(`[stops] ${usable.length} stops from ${path}`);
  return usable;
};
