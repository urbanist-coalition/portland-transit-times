/**
 * @file The stop list inlined into the page by the build.
 *
 * Pairs rather than objects, and code plus name rather than whole stops,
 * because this is bytes on every home page load. Parsed once here and shared
 * by whatever imports it — the search box and the quick stops chips both need
 * it, and neither should pay for it twice.
 */

const element = document.getElementById("stops-data");

/** [code, name] for every stop with a code, in code order. */
export const stops = element ? JSON.parse(element.textContent) : [];

export const stopNames = new Map(stops);
