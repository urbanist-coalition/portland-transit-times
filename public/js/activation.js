/**
 * @file Doing nothing until the reader is actually here.
 *
 * Pages on this site are prerendered — see the speculation rules in the
 * layout — which means Chrome may fetch and fully run a stop page in the
 * background when a finger goes down on a link, and then throw it away if the
 * tap never lands.
 *
 * A prerendered page runs its scripts. So anything with an effect beyond
 * drawing has to wait for activation, or it happens for pages nobody opened:
 * polling for arrivals nobody is reading, recording a stop in the rider's
 * recents that they never visited, counting a pageview that never happened.
 */

/** Runs now, or on activation if this page is currently a prerender. */
export function whenActivated(run) {
  if (!document.prerendering) {
    run();
    return;
  }
  document.addEventListener("prerenderingchange", () => run(), { once: true });
}
