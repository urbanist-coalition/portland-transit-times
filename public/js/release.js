/**
 * @file Noticing that the screen is running a release that has been replaced.
 *
 * Every other page on this site fixes itself: somebody navigates, and they get
 * whatever was deployed. A board does not. It is opened once on a television
 * bolted to a wall and left for weeks, so a fix shipped on Tuesday reaches the
 * riders standing in front of it approximately never — the data keeps moving,
 * because that is polled, and the code that draws it never changes.
 *
 * So the board polls one more thing: the manifest of the release it is being
 * served from. When that stops matching the one it started with, the release
 * underneath it has been replaced and it reloads itself.
 *
 * The reloading is the hard half, and it lives in tv.js because it needs a
 * service worker. What is here is the part worth testing: what counts as a
 * different release, and when a screen is allowed to act on it.
 */

/** Written into every release by the builder — see src/lib/release.ts. */
export const RELEASE_URL = "/release.json";

/**
 * What identifies a release, as one string.
 *
 * Both halves, because both change what is on the screen. `appVersion` is the
 * commit, so it moves when a fix is deployed; `feedHash` moves when the agency
 * publishes a new timetable, and the board's own markup is built from that —
 * the stop's name and its route pills are in the HTML, not polled, so a stop
 * renamed on Tuesday keeps its old name on the wall until the page is loaded
 * again.
 *
 * `builtAt` is deliberately not in it. It changes on every build whether or
 * not anything else did, and a screen that reloaded every time the builder ran
 * would be reloading itself all day for nothing.
 */
export function releaseId(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const { feedHash, appVersion } = manifest;
  if (typeof feedHash !== "string" || typeof appVersion !== "string") {
    return null;
  }
  return `${feedHash}:${appVersion}`;
}

/**
 * Whether to act on what was just fetched.
 *
 * `attempted` is the last release this screen already tried to reload for, and
 * it is what stops a television reloading forever. If a reload does not take —
 * the new page is served from a cache, the network went away halfway, anything
 * — the screen would come back up, notice the same mismatch and go again, and
 * a board caught in that loop is worse than a board running old code, because
 * old code at least shows the times.
 *
 * So each release gets one attempt. If it did not work, the screen keeps
 * running what it has until the next release comes along, and somebody has all
 * the time in the world to notice.
 */
export function shouldAdopt(booted, current, attempted) {
  if (!current || !booted) return false;
  if (current === booted) return false;
  if (current === attempted) return false;
  return true;
}
