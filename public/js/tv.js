/**
 * @file Keeping the TV board current.
 *
 * The stop page's equivalent of this, /js/arrivals.js, spends most of its
 * length reconciling: matching rows by key so a card is updated rather than
 * replaced, because replacing them would restart every animation once a second
 * and drop the reader's text selection. None of that applies to three rows
 * that nobody can select, so this compares the rendered string against the one
 * already on screen and writes only when it differs — which, for a board whose
 * largest number changes once a minute, is almost never.
 *
 * What it adds instead is everything a screen left running for a month needs
 * and a page open for ten seconds does not: a clock, and a request that the
 * television not go to sleep.
 */

import { alertsForStop } from "/js/alert-rules.js";
import { poll, staleNotice } from "/js/poll.js";
import { formatTime } from "/js/render-arrivals.js";
import { renderTvAlert, renderTvBoard } from "/js/render-tv.js";

const POLL_MS = 1000;
/**
 * Alerts change a few times a week, so they get their own slow loop rather
 * than a place in the one that redraws the countdown every second. A minute is
 * still far faster than the thing being described: nobody posts an alert and
 * expects the screens to have it before they have finished typing.
 */
const ALERTS_POLL_MS = 60_000;

const board = document.getElementById("tv-board");
const clock = document.getElementById("tv-clock");
const stale = document.getElementById("tv-stale");
const alertSlot = document.getElementById("tv-alert");
const stopCode = board?.dataset.stopCode;

/** What a service alert's selectors name — see /js/alert-rules.js. */
const stop = {
  stopId: board?.dataset.stopId,
  routeIds: (board?.dataset.routeIds || "").split(",").filter(Boolean),
};

/** null until the first successful fetch; the board shows "Loading…" until then. */
let arrivals = null;
let lastModified = null;
/** When the times on screen were worked out, so staleNotice can age them. */
let dataAt = 0;
/** What the board is currently showing, so an identical render is not written. */
let painted = null;
/** The same, for the alert band, which is redrawn on its own schedule. */
let paintedAlert = null;

function paint() {
  const now = Date.now();

  // The board's own clock. `formatTime` rather than anything local, so the
  // hour in the corner is in the same timezone as the times under it — the
  // agency's, which on a screen bolted to a wall in Portland is also the
  // reader's, but is not necessarily the one the television is set to.
  if (clock) clock.textContent = formatTime(now);

  if (!arrivals) return;

  const html = renderTvBoard(arrivals, now);
  if (html !== painted) {
    board.innerHTML = html;
    painted = html;
  }
}

async function fetchSnapshot() {
  // Driven conditionally for the same reason /js/arrivals.js drives it: the
  // snapshot has a `last-modified` and no freshness lifetime, so a browser left
  // to its own heuristic will happily sit on a copy for minutes.
  const response = await fetch(`/data/arrivals/${stopCode}.json`, {
    cache: "no-store",
    headers: lastModified ? { "if-modified-since": lastModified } : {},
  });
  if (response.status === 304 || !response.ok) return;

  lastModified = response.headers.get("last-modified") || lastModified;
  arrivals = await response.json();
  dataAt = Date.now();
}

/**
 * Says how old the times are, once they are old enough to mislead.
 *
 * This matters more here than anywhere else on the site. A rider whose phone
 * has lost signal knows it has; a board on a wall showing a confident "4 mins"
 * that stopped moving an hour ago has no such tell, and someone will miss a
 * bus because of it.
 */
function markStale() {
  if (!stale) return;
  const message = staleNotice(dataAt, Date.now());
  if (message) stale.textContent = message;
  stale.hidden = message === null;
}

/**
 * The one alert worth a band, or none.
 *
 * Only the first: alertsForStop returns them worst first, and a board that
 * stacks three notices has given the screen to the thing a rider can do
 * nothing about. Anyone who needs the rest has a stop page.
 *
 * Its own fetch and its own failure: an alerts endpoint that breaks must not
 * take the arrivals down with it, so nothing here touches the board.
 */
async function tickAlerts() {
  if (!alertSlot) return;

  let alerts = [];
  try {
    const response = await fetch("/data/alerts.json", { cache: "no-store" });
    if (response.ok) alerts = await response.json();
  } catch {
    // Leave whatever is on screen; the next pass is a minute away.
    return;
  }

  const [worst] = alertsForStop(alerts, stop, Date.now());
  const html = renderTvAlert(worst);
  if (html !== paintedAlert) {
    alertSlot.innerHTML = html;
    paintedAlert = html;
  }
}

async function tick() {
  try {
    await fetchSnapshot();
  } catch {
    // One dropped poll is not worth saying anything about — the next is a
    // second away. A run of them is what markStale is for.
  }
  paint();
  markStale();
}

/**
 * Ask the screen to stay awake.
 *
 * A board that has blanked itself is worse than no board, and the alternative
 * is asking whoever mounts the television to find the sleep setting. The lock
 * is dropped by the browser whenever the page is hidden, so it is retaken on
 * every return rather than acquired once.
 *
 * Entirely best-effort: not every browser has this, some only grant it after
 * an interaction, and there is nothing useful to say to a reader if it is
 * refused. The board works either way.
 */
function keepAwake() {
  if (!("wakeLock" in navigator)) return;

  const request = () => {
    if (document.hidden) return;
    navigator.wakeLock.request("screen").catch(() => {});
  };

  document.addEventListener("visibilitychange", request);
  request();
}

if (board && stopCode) {
  poll(tick, POLL_MS);
  poll(tickAlerts, ALERTS_POLL_MS);
  keepAwake();
}
