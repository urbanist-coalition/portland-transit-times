/**
 * @file Keeping the arrivals on a stop page current.
 *
 * The page already has real times in it when it arrives — the worker splices
 * them in as it writes each snapshot — so this has nothing to draw at load.
 * Its job is only to keep them moving: poll the snapshot, and re-render as the
 * clock crosses each minute.
 *
 * The markup comes from /js/render-arrivals.js, the same module the worker
 * uses, so what this paints is what the page was born with. What is left here
 * is reconciliation: matching rows by key and updating them in place, because
 * replacing the list wholesale would restart every card's animation once a
 * second and undo the browser's text selection along with it.
 */

import { whenActivated } from "/js/activation.js";
import { renderArrivals } from "/js/render-arrivals.js";

const POLL_MS = 1000;
/** Must match the .is-leaving animation in arrivals.css. */
const LEAVING_MS = 400;
/**
 * How old the times may get before the page says so. The feed moves every five
 * seconds, so a minute and a half of silence means something is wrong — no
 * signal, or a worker that has stopped writing.
 */
const STALE_AFTER_MS = 90_000;

const container = document.getElementById("arrivals");
const stopCode = container?.dataset.stopCode;

/** null until the first successful fetch: the page's own HTML stands in. */
let arrivals = null;
let lastModified = null;
/**
 * When the times on screen were worked out. Seeded from the page itself, which
 * the worker stamped as it wrote it, so a page restored from the cache with no
 * network knows how old it is.
 */
let dataAt =
  Number(container?.querySelector(".arrivals-stale")?.dataset.at) || 0;
const leavingTimers = new Map();

const scratch = document.createElement("div");

/*
 * Rows and day dividers both carry a data-key, and both are reconciled by it:
 * a divider that is not part of the ordered list drifts away from the day it
 * belongs to as soon as a row above it drops out. Only the cards animate, so
 * the two part company below, where they need to.
 */
function reconcile(fresh) {
  const freshRows = [...fresh.querySelectorAll("[data-key]")];

  // No arrivals is not a list of zero rows, it is a different piece of markup.
  if (fresh.querySelector(".arrival") === null) {
    if (container.innerHTML !== fresh.innerHTML)
      container.innerHTML = fresh.innerHTML;
    return;
  }

  container.querySelector(".arrivals-none")?.remove();

  const existing = new Map(
    [...container.querySelectorAll("[data-key]")].map((row) => [
      row.dataset.key,
      row,
    ])
  );

  // Rows go after the staleness notice, which is the first thing the renderer
  // emits and the one element here that is not replaced on every pass.
  let previous = container.querySelector(".arrivals-stale");
  for (const freshRow of freshRows) {
    const key = freshRow.dataset.key;
    let row = existing.get(key);

    if (row) {
      // A row that was on its way out and came back is live again.
      row.classList.remove("is-leaving");
      window.clearTimeout(leavingTimers.get(key));
      leavingTimers.delete(key);

      if (row.innerHTML !== freshRow.innerHTML)
        row.innerHTML = freshRow.innerHTML;
      if (row.dataset.tooLight !== freshRow.dataset.tooLight) {
        row.dataset.tooLight = freshRow.dataset.tooLight;
      }
      if (row.getAttribute("style") !== freshRow.getAttribute("style")) {
        row.setAttribute("style", freshRow.getAttribute("style"));
      }
    } else {
      row = freshRow;
      row.classList.add("is-entering");
    }

    // Order can change — a delayed bus falls behind one running on time.
    const target = previous ? previous.nextSibling : container.firstChild;
    if (target !== row) container.insertBefore(row, target);
    previous = row;
  }

  const freshKeys = new Set(freshRows.map((row) => row.dataset.key));
  for (const [key, row] of existing) {
    if (freshKeys.has(key)) continue;
    // A divider outlives its day for one tick, at midnight or when the last of
    // that day's rows departs. It has nothing to fade — it just goes, before
    // the row it was introducing has finished leaving.
    if (!row.classList.contains("arrival")) {
      row.remove();
      continue;
    }
    if (row.classList.contains("is-leaving")) continue;
    row.classList.add("is-leaving");
    leavingTimers.set(
      key,
      window.setTimeout(() => {
        leavingTimers.delete(key);
        row.remove();
      }, LEAVING_MS)
    );
  }
}

function paint() {
  if (!arrivals) return;
  scratch.innerHTML = renderArrivals(arrivals, Date.now());
  reconcile(scratch);
}

async function poll() {
  // Drive the conditional request rather than leaving it to the browser cache.
  // The snapshot is served with `last-modified` and no freshness lifetime, so
  // a browser applies its own heuristic and can sit on a copy for minutes —
  // which is how old arrivals used to filter in. `no-store` keeps the cache
  // out of it; tracking `last-modified` here keeps the 304s.
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
 * Says how old the times are, once they are old enough to mislead. Runs on
 * every tick rather than after a render, because the case that matters is the
 * one where no render ever happens: offline, with the page as it was cached.
 */
function markStale() {
  const notice = container.querySelector(".arrivals-stale");
  if (!notice) return;

  const age = Date.now() - dataAt;
  if (!dataAt || age < STALE_AFTER_MS) {
    notice.hidden = true;
    return;
  }
  const minutes = Math.max(1, Math.round(age / 60_000));
  notice.textContent = `Not updating — these times are about ${minutes} min old`;
  notice.hidden = false;
}

async function tick() {
  try {
    await poll();
  } catch {
    // A dropped poll is not worth reporting: the next one is a second away,
    // and the times already on the page are still the best we have. What is
    // worth reporting is a run of them, which markStale does.
  }
  // Runs whether or not the poll brought anything new: the countdowns are
  // relative to now, so they change on their own.
  paint();
  markStale();
}

if (container && stopCode) {
  let timer = null;

  function start() {
    if (timer !== null) return;
    tick();
    timer = window.setInterval(tick, POLL_MS);
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
   * Coming back is not always a visibility change, and polling that stays
   * stopped leaves the countdowns from whenever the reader last looked — the
   * one thing this page must never show. An installed app frozen in the
   * background and reopened, or a page restored from the back/forward cache,
   * can arrive with only some of these; whichever comes first starts the poll
   * again, and the rest find it already running.
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
