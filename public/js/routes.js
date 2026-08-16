/**
 * @file The order routes are listed in.
 *
 * Route names are numbers, numbers with a letter, and initials — 1, 9A, 21,
 * 24B, BRZ — so plain alphabetical ordering puts 21 and 24A ahead of 4, which
 * is how nobody reads a list of bus routes. Comparing the numeric runs as
 * numbers gives 1, 2, 4, 5, 7, 8, 9A, 9B, 21, 24A, 24B, BRZ, HSK.
 *
 * Used by the build for the pills on a stop page and by the map for the ones
 * in a popup, so a stop lists its routes the same way wherever it appears.
 */

const collator = new Intl.Collator("en", { numeric: true });

export function compareRouteNames(a, b) {
  return collator.compare(a, b);
}
