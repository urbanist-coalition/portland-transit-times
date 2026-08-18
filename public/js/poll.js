/**
 * @file Running something once a second, but only while somebody is looking.
 *
 * Two pages need this — the arrivals on a stop page and the calls on a trip
 * page — and both need it for the same reason: what they show is a countdown,
 * so a poll that stays stopped leaves the times from whenever the reader last
 * looked, which is the one thing neither page may ever do.
 *
 * It lives here rather than in either of them because the hard part is not the
 * interval, it is all the ways a page comes back. That has been got wrong twice
 * already — an installed app frozen in the background and reopened, and a page
 * restored from the back/forward cache — and each fix belongs to both pages.
 */

import { whenActivated } from "/js/activation.js";

/**
 * Calls `tick` now and every `intervalMs` while the page is visible.
 *
 * Returns nothing to stop it with: these pages poll for as long as they are
 * open, and the lifecycle below is the whole of the control.
 */
export function poll(tick, intervalMs) {
  let timer = null;

  function start() {
    if (timer !== null) return;
    tick();
    timer = window.setInterval(tick, intervalMs);
  }

  function stop() {
    window.clearInterval(timer);
    timer = null;
  }

  function sync() {
    // A prerendered page is not being read; whenActivated owns its first start.
    if (document.prerendering) return;
    document.hidden ? stop() : start();
  }

  // A backgrounded tab shows nobody a countdown, so it should not ask for one.
  document.addEventListener("visibilitychange", sync);

  /*
   * Coming back is not always a visibility change. An installed app frozen in
   * the background and reopened, or a page restored from the back/forward
   * cache, can arrive with only some of these; whichever comes first starts the
   * poll again, and the rest find it already running.
   *
   * Each one asks `document.hidden` rather than assuming, so none of them can
   * start a poll for a page nobody is looking at.
   */
  document.addEventListener("resume", sync);
  window.addEventListener("pageshow", sync);
  window.addEventListener("focus", sync);

  // Nor does a prerendered page: the times it was born with are correct as of
  // when the worker wrote them, and polling can wait until someone arrives.
  whenActivated(start);
}

/**
 * How old the times on screen may get before a page says so. The feed moves
 * every five seconds, so a minute and a half of silence means something is
 * wrong — no signal, or a worker that has stopped writing.
 */
export const STALE_AFTER_MS = 90_000;

/**
 * What to tell a reader whose times have stopped moving, or null while they
 * are still fresh enough to trust.
 *
 * The case this is for is the one where no render ever happens: offline, on a
 * platform, with the page as it was cached. So it is written from the age of
 * the data rather than from anything the page did.
 */
export function staleNotice(dataAt, now) {
  const age = now - dataAt;
  if (!dataAt || age < STALE_AFTER_MS) return null;
  const minutes = Math.max(1, Math.round(age / 60_000));
  return `Not updating — these times are about ${minutes} min old`;
}
