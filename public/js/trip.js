/**
 * @file Watching a bus work its way down its trip.
 *
 * The page arrives with times already in it — the build wrote the timetable,
 * and the worker wrote predictions over the top if this bus is out — so there
 * is nothing to draw at load. This keeps them moving: poll the trip's snapshot,
 * re-render, and let the rider watch the stops behind the bus go quiet one by
 * one.
 *
 * The markup comes from /js/render-trip.js, the same module that wrote the page,
 * so what this paints is what the page was born with.
 *
 * Two things are different from a stop page. The list of stops never changes —
 * a trip calls where it calls — so rows are only ever updated in place, never
 * added, removed or reordered; and a trip that is not running has no snapshot
 * at all, in which case the timetable already on the page is the whole truth
 * and there is nothing to poll for but the moment it sets off.
 */

import { poll, staleNotice } from "/js/poll.js";
import { renderTripCalls } from "/js/render-trip.js";
import { tripSlug } from "/js/trips.js";

const POLL_MS = 1000;
/**
 * Missed polls before a page decides its bus has really finished.
 *
 * One 404 is not the end of a trip. The worker clears every snapshot when it
 * starts and when a release lands, and takes about three seconds to write them
 * again — so a single miss is usually a deploy, not a bus reaching the end of
 * the line. Believing it emptied the rail and filled it back in a moment later,
 * every time anything shipped.
 */
const MISSES_BEFORE_FINISHED = 5;

const list = document.getElementById("trip-calls");
const tripId = list?.dataset.tripId;
const from = new URLSearchParams(window.location.search).get("from");

/** null until this trip is running: the page's own HTML stands in. */
let calls = null;
let lastModified = null;
/**
 * When the times on screen were worked out. Seeded from the page, which the
 * worker stamped as it wrote it, so a page restored from the cache with no
 * network knows how old it is. Zero while the page is only a timetable, which
 * cannot go stale.
 */
let dataAt = Number(list?.querySelector(".trip-stale")?.dataset.at) || 0;
/** Consecutive polls that found no snapshot. See MISSES_BEFORE_FINISHED. */
let misses = 0;

const scratch = document.createElement("div");

/*
 * The rider's own stop, from the arrivals card they tapped. Compared in a loop
 * rather than with an attribute selector: a stop id is "0:227", and a colon in
 * a selector is a pseudo-class unless it is escaped.
 *
 * Re-applied after every paint would be wasted work — a paint replaces the
 * contents of each row, never the row — so the attribute set here survives.
 */
function markFrom() {
  if (!list || !from) return null;

  let first = null;
  for (const row of list.querySelectorAll(".trip-call")) {
    if (row.dataset.stopId !== from) continue;
    row.dataset.from = "true";
    first ||= row;
  }
  return first;
}

/**
 * Updates each row from a fresh render of the same stops.
 *
 * Matched by key rather than by position because a loop route calls at one stop
 * twice, and because replacing the list wholesale would undo the browser's text
 * selection and the rider's place on the page a second after they found it.
 */
function reconcile(fresh) {
  const rows = new Map(
    [...fresh.querySelectorAll(".trip-call")].map((row) => [
      row.dataset.key,
      row,
    ])
  );

  for (const row of list.querySelectorAll(".trip-call")) {
    const next = rows.get(row.dataset.key);
    if (!next) continue;
    if (row.innerHTML !== next.innerHTML) row.innerHTML = next.innerHTML;
    if (row.dataset.state !== next.dataset.state) {
      row.dataset.state = next.dataset.state;
    }
  }
}

function paint() {
  if (!calls) return;
  scratch.innerHTML = renderTripCalls(calls, Date.now());
  reconcile(scratch);
}

async function fetchSnapshot() {
  // Drive the conditional request rather than leaving it to the browser cache,
  // for the same reason the arrivals do: a browser left to its own heuristic
  // will sit on a copy of a no-freshness-lifetime response for minutes.
  const response = await fetch(`/data/trips/${tripSlug(tripId)}.json`, {
    cache: "no-store",
    headers: lastModified ? { "if-modified-since": lastModified } : {},
  });

  /*
   * No snapshot means no bus: it has finished, or has not set off — but only
   * once several polls in a row have said so, because a worker restart takes
   * the snapshots away for a few seconds while it writes them again.
   *
   * A page that was showing live times then goes back to the timetable, which
   * it can do without asking for anything: a call with its instants stripped
   * off is exactly the timetable row the build wrote. That matters because the
   * worker puts the same page back at the same moment, and without it a rider
   * watching a trip end would be left with the last predictions frozen mid-run
   * while anyone reloading the same URL saw the timetable.
   */
  if (response.status === 404) {
    if (++misses < MISSES_BEFORE_FINISHED) return;
    calls =
      calls &&
      calls.map(({ stopId, stopCode, stopName, sequence, time }) => ({
        stopId,
        stopCode,
        stopName,
        sequence,
        time,
      }));
    dataAt = 0;
    lastModified = null;
    return;
  }
  if (response.status === 304 || !response.ok) return;

  misses = 0;
  lastModified = response.headers.get("last-modified") || lastModified;
  calls = await response.json();
  dataAt = Date.now();
}

/**
 * Says how old the times are, once they are old enough to mislead — and only
 * for a page showing live ones. A timetable is as true in an hour as it is now.
 */
function markStale() {
  const message = dataAt ? staleNotice(dataAt, Date.now()) : null;
  let notice = list.querySelector(".trip-stale");

  if (!message) {
    if (notice) notice.hidden = true;
    return;
  }

  // A page that was built as a timetable and went live while the reader was
  // watching has no stamp of its own to fill in.
  if (!notice) {
    notice = document.createElement("p");
    notice.className = "trip-stale";
    list.prepend(notice);
  }
  notice.textContent = message;
  notice.hidden = false;
}

async function tick() {
  try {
    await fetchSnapshot();
  } catch {
    // A dropped poll is not worth reporting: the next one is a second away, and
    // the times already on the page are still the best we have. What is worth
    // reporting is a run of them, which markStale does.
  }
  // Runs whether or not the poll brought anything new: which stops are behind
  // the bus is relative to now, so it changes on its own.
  paint();
  markStale();
}

/**
 * Offers the way back to the arrivals the reader came from.
 *
 * The link is taken off the row itself rather than built from `?from=`, which
 * carries a stop id and not the code a page is addressed by. The row already
 * links to that stop — every call on the page does — so there is nothing to
 * derive and no convention about id formats to depend on. A stop the feed gives
 * no code has no link to lend, and no button appears.
 */
function offerWayBack(row) {
  const button = document.querySelector("[data-back-to-stop]");
  const stop = row.querySelector("a.trip-call-stop");
  if (!button || !stop) return;

  const href = stop.getAttribute("href");
  button.href = href;
  button.textContent = `Back to ${stop.textContent}`;
  button.hidden = false;

  /*
   * Goes *back* to that stop when back is where it is, rather than forward to
   * another copy of it.
   *
   * Following the link would leave the stop page with the trip page ahead of
   * it in history, so the reader arrives where they started and then finds
   * their own back button returns them to the trip they just left. Popping the
   * entry instead puts them exactly where they were, scroll position and all.
   *
   * It stays a real link, and the click is only intercepted when the referrer
   * says that stop is genuinely the previous page — opened from a shared link
   * there is nothing behind this page, and the label has to be honest either
   * way, so the plain navigation stands.
   */
  button.addEventListener("click", (event) => {
    let previous;
    try {
      previous = new URL(document.referrer);
    } catch {
      return; // No referrer: a shared link, or a new tab. Let it navigate.
    }
    if (previous.origin !== window.location.origin) return;
    if (previous.pathname !== href) return;

    event.preventDefault();
    window.history.back();
  });
}

if (list && tripId) {
  const row = markFrom();
  if (row) {
    const box = row.getBoundingClientRect();
    const visible = box.top >= 0 && box.bottom <= window.innerHeight;
    // Only when it is not already on screen: a trip a rider boards near the
    // start needs no scrolling, and moving the page under them anyway is
    // disorienting. Instant, because this is where the page starts, not
    // somewhere it travelled to.
    if (!visible) row.scrollIntoView({ block: "center", behavior: "instant" });
    offerWayBack(row);
  }

  poll(tick, POLL_MS);
}
