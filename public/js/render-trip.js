/**
 * @file A trip's calls, as HTML.
 *
 * The other half of render-arrivals.js. That one answers "what is coming to
 * this stop"; this one answers "where does this bus go, and when does it get
 * there" — the same buses seen along their length rather than across.
 *
 * Same rules, for the same reason: a string function with no DOM and no
 * browser globals, so the build can write the list into the page and the
 * browser can redraw it later without the two disagreeing.
 *
 * It renders two kinds of row from one shape. A call always carries the
 * timetable's own `time`, an "HH:MM:SS" that is true of every day the trip
 * runs; a call being shown for a particular running of the trip also carries
 * `scheduledTime`/`predictedTime` as instants, and those go through the same
 * status wording the arrivals use.
 */

import { escapeHtml } from "./html.js";
import { formatTime, predictionStatus } from "./render-arrivals.js";

/**
 * A GTFS time of day as a clock reading: "11:35:00" -> "11:35 am".
 *
 * Deliberately string arithmetic rather than a date. A timetable time is not
 * an instant — it is what the printed schedule says, true on every day the
 * trip runs — so turning it into one would mean choosing a date, and a page
 * that shows the same trip on Tuesday and on Friday has no date to choose.
 *
 * Written to agree exactly with formatTime's Intl output for the same wall
 * clock, because the live rows use that and the two sit in one list. GTFS
 * hours run past 24 for trips that finish after midnight, which is why the
 * hour is taken modulo 24 before the meridiem and modulo 12 for the reading:
 * "25:10:00" is ten past one in the morning.
 */
/**
 * Where a stop name's disambiguating suffix starts.
 *
 * Stops that share a name are told apart by where their buses go — "Route 1 +
 * Route 88 ⇨ Falmouth Shaw's" — which is what a rider searching a list of 656
 * stops needs. On a trip page it is noise: the heading already says where this
 * bus is going, and 35 of these read as the same destination repeated down the
 * page. The rail says which stop is which here.
 *
 * The arrow is written by generateStopNameOverrides in
 * src/lib/loaders/stop-name-deduplication.ts, and nothing else in the feed's
 * names uses it.
 */
const NAME_SUFFIX = "⇨";

function shortStopName(stopName) {
  const name = String(stopName ?? "");
  const arrow = name.indexOf(NAME_SUFFIX);
  return arrow === -1 ? name : name.slice(0, arrow).trim();
}

export function formatClock(time) {
  const [hours, minutes] = String(time).split(":");
  const hour = Number(hours);
  const reading = hour % 12 || 12;
  const meridiem = hour % 24 < 12 ? "am" : "pm";
  return `${reading}:${minutes} ${meridiem}`;
}

/**
 * One call, as a row.
 *
 * The stop's name is the link out — a rider looking at where this bus goes is
 * one tap from what else stops there — and every call in the feed is at a stop
 * with a page, so there is no row that cannot offer one.
 */
function renderCall(call, now, isLast) {
  const live = typeof call.scheduledTime === "number";
  const prediction = live ? predictionStatus(call, now) : null;

  /*
   * When the bus is actually expected, large; what the timetable said, small
   * and struck through beneath it, and only once the two disagree.
   *
   * The arrivals card can afford to put those side by side — it is showing one
   * bus. Thirty-odd rows of that leaves nothing to scan, and a column of times
   * down the left is the whole point of this page.
   */
  const times = prediction
    ? [
        `<span class="trip-call-clock">${formatTime(prediction.predicted)}</span>`,
        prediction.delta !== 0 || prediction.skipped
          ? `<span class="trip-call-was">${formatTime(prediction.scheduled)}</span>`
          : "",
      ].join("")
    : `<span class="trip-call-clock">${formatClock(call.time)}</span>`;

  /*
   * The badge, on the same rule as the arrivals card: only where the agency
   * has said something about this call. A stop whose time was worked out from
   * the delay on either side of it moves, but does not get a badge — the badge
   * is the claim, and nobody made it.
   *
   * "Departed" is dropped here, though. On a stop page it explains why a row
   * that has gone is still on screen; on a trip page it would be on every row
   * above the bus, saying what the dimming already says.
   */
  const status =
    prediction?.message && prediction.tone !== "idle"
      ? `<span class="arrival-status" data-status="${prediction.tone}">${prediction.message}</span>`
      : "";

  // A row is "passed" once the bus is through it, which only a prediction can
  // say. Without one every row is simply a time in a timetable.
  const state = prediction?.departed ? "passed" : "ahead";

  // A stop the feed gives no code has no page of its own to offer.
  const label = escapeHtml(shortStopName(call.stopName));
  const name = call.stopCode
    ? `<a class="trip-call-stop" href="/stops/${encodeURIComponent(call.stopCode)}/">${label}</a>`
    : `<span class="trip-call-stop">${label}</span>`;

  // Keyed by sequence as well as stop: a loop route calls at the same stop
  // twice on one trip, and those two rows are not the same row.
  return [
    `<li class="trip-call" data-key="${escapeHtml(`${call.stopId}:${call.sequence}`)}"`,
    ` data-stop-id="${escapeHtml(call.stopId)}"`,
    ` data-state="${state}"`,
    isLast ? ` data-last="true"` : "",
    `>`,
    `<p class="trip-call-times">${times}</p>`,
    `<p class="trip-call-body">`,
    name,
    status,
    // Said once, at the bottom, rather than left to be inferred from the list
    // running out: the last row is where a rider on board has to get off.
    isLast ? `<span class="trip-call-end">Trip ends here</span>` : "",
    `</p>`,
    `</li>`,
  ].join("");
}

/**
 * The complete contents of the calls block: every stop the trip makes, in
 * order, with the time it is due at each.
 *
 * `now` only matters for calls carrying predictions; a plain timetable renders
 * the same at any hour, which is what lets the build write it once.
 */
export function renderTripCalls(calls, now = Date.now()) {
  const list = calls || [];
  if (list.length === 0) {
    return `<p class="trip-calls-none">No stops on this trip</p>`;
  }

  /*
   * When these times were worked out, for the rows that have one.
   *
   * Only a running trip can go stale. A timetable is as true an hour from now
   * as it is at this second, so a page showing one gets no stamp and never
   * claims to be live — which is also what tells /js/trip.js that the bus it is
   * watching has not set off yet.
   */
  const live = list.some((call) => typeof call.scheduledTime === "number");
  const stamp = live
    ? `<p class="trip-stale" data-at="${now}" hidden></p>`
    : "";

  const rows = list.map((call, index) =>
    renderCall(call, now, index === list.length - 1)
  );
  return `${stamp}<ol class="trip-calls">${rows.join("")}</ol>`;
}
