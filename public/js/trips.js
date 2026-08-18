/**
 * @file Where a trip lives.
 *
 * A trip is addressed by the id the feed gives it, and 667 of this feed's 1,345
 * are called things like "No School793080" — a space and all. That survives a
 * URL, but it also becomes a directory name in the release, on a volume, and in
 * whatever shell script eventually walks over it, so it is folded down to
 * something plain first.
 *
 * The fold is not reversible and does not need to be: nothing reads a trip id
 * back out of a path. It only needs to be a function, and to not collide —
 * checked against this feed, all 1,345 ids give 1,345 distinct slugs.
 *
 * Imported by the browser, by eleventy.config.mjs to build the permalinks, and
 * by the worker, so a link and the page it points at cannot disagree.
 */

export function tripSlug(tripId) {
  return String(tripId).replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function tripPath(tripId) {
  return `/trips/${tripSlug(tripId)}/`;
}
