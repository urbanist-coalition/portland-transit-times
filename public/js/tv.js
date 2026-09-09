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
import { RELEASE_URL, releaseId, shouldAdopt } from "/js/release.js";
import { readSettings } from "/js/tv-settings.js";
import { formatTime } from "/js/render-arrivals.js";
import { renderTvBoard, renderTvTicker } from "/js/render-tv.js";

const POLL_MS = 1000;
/**
 * Alerts change a few times a week, so they get their own slow loop rather
 * than a place in the one that redraws the countdown every second. A minute is
 * still far faster than the thing being described: nobody posts an alert and
 * expects the screens to have it before they have finished typing.
 */
const ALERTS_POLL_MS = 60_000;

/**
 * How long a screen waits before acting on a new release.
 *
 * Spread out, so a fleet of them does not reload in lockstep the moment a
 * deploy lands. Ten boards hitting a handful of static files is nothing; ten
 * boards all blank at the same second in the same station is a thing somebody
 * notices and asks about.
 */
const RELOAD_SPREAD_MS = 20_000;

/** Remembers the release this screen already tried to reload for. */
const ATTEMPTED_KEY = "tv-release-attempted";

const board = document.getElementById("tv-board");
const clock = document.getElementById("tv-clock");
const stale = document.getElementById("tv-stale");
const alertSlot = document.getElementById("tv-alert");
const frame = document.querySelector(".tv");
const stopCode = board?.dataset.stopCode;

/** What a service alert's selectors name — see /js/alert-rules.js. */
const stop = {
  stopId: board?.dataset.stopId,
  routeIds: (board?.dataset.routeIds || "").split(",").filter(Boolean),
};

/*
 * Everything this screen was told, read from its own address. Nothing is stored
 * in the browser, so there is one source of truth and it is the thing somebody
 * pointed the panel at — see /js/tv-settings.js.
 *
 * The row count is fixed for the life of the page. The message is not: it is
 * re-read on every alerts pass, because it carries an expiry and has to take
 * itself down without anyone touching the screen.
 */
const { rows } = readSettings(window.location.search);

/*
 * How many rows are on screen decides how much room the hero has left, and the
 * number in it is far too big to be allowed to work that out for itself — see
 * [data-rows] in tv.css.
 */
if (frame) frame.dataset.rows = String(rows);

/** null until the first successful fetch; the board shows "Loading…" until then. */
let arrivals = null;
let lastModified = null;
/** When the times on screen were worked out, so staleNotice can age them. */
let dataAt = 0;
/** The release this page was served by, learnt on the first poll. */
let bootedRelease = null;
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

  const html = renderTvBoard(arrivals, now, rows);
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
 * The alerts this stop should be scrolling, if any.
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

  /*
   * The screen's own message runs alongside the feed's, not instead of it: an
   * elevator notice typed in a back office does not stop a route being
   * suspended. It sorts by severity with the rest, and readMessage drops it
   * once its time is up.
   */
  const now = Date.now();
  const { message } = readSettings(window.location.search, now);
  const html = renderTvTicker(
    alertsForStop(message ? [...alerts, message] : alerts, stop, now)
  );
  if (html !== paintedAlert) {
    alertSlot.innerHTML = html;
    paintedAlert = html;
  }
}

/**
 * Reload onto the new release, once the browser is actually able to serve it.
 *
 * A plain reload is not enough, and the reason is worth stating: the service
 * worker serves pages network-first but stylesheets and modules
 * stale-while-revalidate, so reloading straight away gets the new HTML running
 * the *old* JavaScript. The version check would then find nothing wrong, the
 * screen would settle, and the fix would never arrive.
 *
 * So the worker is asked to update first. A release whose assets changed has a
 * new sw.js — its cache is named after a fingerprint of them — which installs,
 * skips waiting, deletes the old cache and claims this page, and that fires
 * `controllerchange`. Reloading then gets everything new together.
 *
 * A release that only changed a template has a byte-identical worker and will
 * never fire it, which is why the timer is not merely a safety net: for that
 * case it is the normal path, and reloading with the cached assets is right,
 * because they are the same assets.
 */
function adoptRelease(id) {
  try {
    window.sessionStorage?.setItem(ATTEMPTED_KEY, id);
  } catch {
    // A screen that cannot remember its attempt is a screen that could loop.
    // Better to leave it running the release it has.
    return;
  }

  const wait = Math.random() * RELOAD_SPREAD_MS;
  const reload = () => window.setTimeout(() => window.location.reload(), wait);

  const worker = navigator.serviceWorker;
  if (!worker) return reload();

  worker.addEventListener("controllerchange", reload, { once: true });
  worker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch(() => {});

  // The template-only case above, and the backstop for a worker that never
  // takes over. Racing `reload` with itself is harmless: the first one wins
  // and the page is gone.
  window.setTimeout(reload, 15_000);
}

/**
 * Has the release under this page been replaced?
 *
 * Rides the alerts poll rather than adding a timer of its own — a deploy that
 * lands on the screens within the minute is far sooner than anybody needs.
 */
async function tickRelease() {
  let manifest;
  try {
    const response = await fetch(RELEASE_URL, { cache: "no-store" });
    if (!response.ok) return;
    manifest = await response.json();
  } catch {
    // Offline, or the release is being swapped underneath us. Either way the
    // next pass is a minute away and the times on screen are unaffected.
    return;
  }

  const current = releaseId(manifest);
  if (!current) return;
  if (!bootedRelease) {
    bootedRelease = current;
    return;
  }

  let attempted = null;
  try {
    attempted = window.sessionStorage?.getItem(ATTEMPTED_KEY) ?? null;
  } catch {
    attempted = null;
  }

  if (shouldAdopt(bootedRelease, current, attempted)) adoptRelease(current);
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
  poll(tickRelease, ALERTS_POLL_MS);
  keepAwake();
}
