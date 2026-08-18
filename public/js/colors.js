/**
 * @file Route colours.
 *
 * The agency picks a colour per route in the GTFS feed, and some of them are
 * nearly white. These are the two rules the site applies to arbitrary feed
 * colours, in one place because the browser, the build and the worker all
 * need the same answer — see public/js/package.json for how Node imports this.
 */

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hexColor) {
  const hex = String(hexColor || "").replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => character + character)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0;

  const channel = (value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const r = channel(parseInt(full.slice(0, 2), 16) / 255);
  const g = channel(parseInt(full.slice(2, 4), 16) / 255);
  const b = channel(parseInt(full.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever has the better contrast on this background. */
export function contrastText(hexColor) {
  return relativeLuminance(hexColor) > 0.179 ? "#1a1a1a" : "#ffffff";
}

/**
 * True when a colour is too pale to carry meaning on a light surface — the
 * pills outline themselves, the arrival cards drop their accent stripe, and
 * route names fall back to body text.
 */
export function isTooLight(hexColor, threshold = 0.8) {
  return relativeLuminance(hexColor) > threshold;
}

/**
 * The same problem from the other end: a colour too dark to be seen against a
 * dark page. The trip pages draw a dot per stop in the route's colour, and the
 * 9B's navy on the dark theme's background is a contrast ratio of 1.6 — a row
 * of holes in the rail rather than a row of stops.
 *
 * The threshold is read off this feed rather than picked: it separates the
 * three routes that disappear (9B, 21 and the 1, all under 0.07) from the
 * husky line at 0.11, which reads. Anything caught here falls back to the
 * border grey, on the same principle as isTooLight — a colour that cannot be
 * seen should not be relied on to say anything.
 */
export function isTooDark(hexColor, threshold = 0.08) {
  return relativeLuminance(hexColor) < threshold;
}
