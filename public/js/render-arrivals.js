/**
 * @file The arrivals list, as HTML.
 *
 * This module is the whole reason the stop pages can be fresh without being
 * hydrated. It runs in two places and produces byte-identical output in both:
 *
 *   - in the worker, which splices the result into every stop page each time
 *     the feed refreshes, so a page arrives with real times already in it;
 *   - in the browser, which re-renders from the JSON snapshot as the times
 *     tick over.
 *
 * One renderer means the first paint and the first refresh cannot disagree —
 * the alternative is a template on the server and hand-written DOM code on the
 * client, which drift, and the drift shows as a visible twitch a second after
 * the page loads.
 *
 * It is therefore strictly a string function: no DOM, no browser globals, no
 * dependencies beyond ./colors.js. public/js/package.json is what lets Node
 * import it.
 */

import { isTooLight } from "./colors.js";

/**
 * The agency's timezone, not the reader's. The worker renders these times on a
 * server that could be anywhere, and the client must agree with it exactly, so
 * there is only one defensible choice — and for a rider it is also the right
 * one: a stop's departure time is a time in Portland. Matches GPMETRO.timeZone
 * in src/lib/constants.ts.
 */
const TIME_ZONE = "America/New_York";

const MINUTE_MS = 60_000;
/** Past this, an arrival that hasn't been marked departed is treated as gone. */
const DEPART_THRESHOLD = 1;
/** The countdown only appears once an arrival is within this many minutes. */
const COUNTDOWN_WINDOW = 30;
/**
 * Never render a prediction whose time is further in the past than this. The
 * snapshot only contains instances after `now - 10 min`, so anything older
 * reached us from a stale source — a cached response, or a worker that has
 * stopped writing — and should disappear rather than sit there looking real.
 */
const STALE_THRESHOLD_MS = 10 * MINUTE_MS;

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatTime(epochMs) {
  return timeFormat.format(epochMs).toLowerCase();
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day an instant falls on in Portland, as "YYYYMMDD".
 *
 * Deliberately not `arrival.serviceDate`. A GTFS service day runs past
 * midnight, so the 12:20am run carries the previous date in the feed while the
 * rider reading the page is plainly looking at tomorrow. The day has to come
 * from the same instant the row prints its time from, or a divider and the
 * times under it say different things.
 */
function dayKey(epochMs) {
  const parts = {};
  for (const { type, value } of dayFormat.formatToParts(epochMs)) {
    parts[type] = value;
  }
  return `${parts.year}${parts.month}${parts.day}`;
}

/**
 * The day after `key`, by calendar arithmetic rather than by adding 24 hours:
 * on the morning the clocks go back, 24 hours after 00:30 is still the same
 * date, which would leave the first day of the list labelled with a date
 * instead of "Tomorrow".
 */
function nextDay(key) {
  const date = new Date(
    Date.UTC(
      Number(key.slice(0, 4)),
      Number(key.slice(4, 6)) - 1,
      Number(key.slice(6, 8)) + 1
    )
  );
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function renderDay(day, today, tomorrow) {
  let label = `${day.slice(4, 6)}/${day.slice(6, 8)}`;
  if (day === today) label = "Today";
  else if (day === tomorrow) label = "Tomorrow";

  // Keyed like an arrival so the browser can reconcile it in place; the prefix
  // is what keeps it from colliding with one.
  return `<p class="arrivals-day" data-key="day:${day}">${label}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );
}

const startOfMinute = (epochMs) => Math.floor(epochMs / MINUTE_MS) * MINUTE_MS;

/**
 * Whole minutes between two instants, both rounded down to the minute first.
 *
 * The rounding is the point. Times are shown to the minute, so a delta
 * computed from the raw seconds disagrees with what the reader can see: a bus
 * predicted at 13:00:50 against a 13:02:10 schedule is 1m20s early, but the
 * page says 13:00 and 13:02, and "1 min early" reads as a bug. Accuracy below
 * a minute means nothing for a bus.
 */
const minutesBetween = (a, b) =>
  (startOfMinute(a) - startOfMinute(b)) / MINUTE_MS;

/** Identifies an arrival across refreshes, so a row can be updated in place. */
export function arrivalKey(arrival) {
  return `${arrival.serviceDate}:${arrival.tripId}:${arrival.stopId}`;
}

function renderArrival(arrival, now) {
  const { route, trip } = arrival;
  const scheduled = arrival.scheduledTime;
  const predicted = arrival.predictedTime ?? scheduled;

  const delta = minutesBetween(predicted, scheduled);
  const minutesAway = minutesBetween(predicted, now);
  const skipped = arrival.status === "SKIPPED";
  const departed =
    minutesAway < -DEPART_THRESHOLD || arrival.status === "DEPARTED";

  let statusMessage = "On Time";
  let status = "ok";
  if (skipped) {
    statusMessage = "Canceled";
    status = "warn";
  } else if (departed) {
    statusMessage = "Departed";
    status = "idle";
  } else if (delta > 0) {
    statusMessage = `${delta} min late`;
    status = "late";
  } else if (delta < 0) {
    statusMessage = `${Math.abs(delta)} min early`;
    status = "early";
  }

  // The scheduled time is struck through once something supersedes it.
  const superseded = delta !== 0 || skipped;
  const times = [
    superseded
      ? `<span class="arrival-time-superseded">${formatTime(scheduled)}</span>`
      : `<span>${formatTime(scheduled)}</span>`,
    delta !== 0
      ? `<span class="arrival-arrow" aria-hidden="true"></span><span>${formatTime(predicted)}</span>`
      : "",
    `<span class="arrival-status" data-status="${status}">${statusMessage}</span>`,
  ].join("");

  const countdown =
    !departed && minutesAway <= COUNTDOWN_WINDOW
      ? `<p class="arrival-countdown">Arriving${minutesAway <= 0 ? " now" : ` in ${minutesAway} min`}</p>`
      : "";

  return [
    // `data-too-light` lets the stylesheet drop the accent stripe and the
    // coloured route name for colours that would vanish on a light surface.
    `<article class="arrival" data-key="${escapeHtml(arrivalKey(arrival))}"`,
    ` data-too-light="${isTooLight(route.routeColor)}"`,
    ` style="--route-color:${escapeHtml(route.routeColor)}">`,
    `<h3 class="arrival-route">`,
    `<span class="arrival-route-name">${escapeHtml(route.routeShortName)}</span>`,
    // A terminating run is an arrival, not a departure: naming its headsign
    // would read as "to Portland City Hall" while standing at City Hall, with
    // a countdown, as though it were a bus to catch.
    arrival.terminates
      ? `<span class="arrival-headsign arrival-ends">ends here</span>`
      : `<span class="arrival-headsign">to ${escapeHtml(trip.tripHeadsign)}</span>`,
    `</h3>`,
    `<p class="arrival-times">${times}</p>`,
    countdown,
    `</article>`,
  ].join("");
}

/**
 * The complete contents of the arrivals block: every prediction still worth
 * showing at `now`, or the empty state.
 */
export function renderArrivals(arrivals, now = Date.now()) {
  const live = (arrivals || []).filter(
    (arrival) =>
      (arrival.predictedTime ?? arrival.scheduledTime) >=
      now - STALE_THRESHOLD_MS
  );

  // When these times were worked out. The page can be served from a service
  // worker cache long after that — on a platform with no signal, which is
  // exactly when a rider is reading it — so the reader gets told rather than
  // shown month-old departures as though they were live.
  const stamp = `<p class="arrivals-stale" data-at="${now}" hidden></p>`;

  if (live.length === 0) {
    return `${stamp}<p class="arrivals-none">No upcoming arrivals</p>`;
  }

  /*
   * A day is announced once, by a divider, rather than stamped on every row:
   * past the last bus every row left is tomorrow's, and forty cards each saying
   * so is noise. The list is in scheduled order and nothing re-sorts it, so a
   * day cannot be interrupted and picked up again further down.
   *
   * Starting from today means a divider appears exactly where the day changes —
   * including above the very first row, which is the case that matters most: at
   * 11pm the whole list is tomorrow and nothing else on the page says so.
   */
  const today = dayKey(now);
  const tomorrow = nextDay(today);
  let day = today;

  const html = [stamp];
  for (const arrival of live) {
    const arrivalDay = dayKey(arrival.predictedTime ?? arrival.scheduledTime);
    if (arrivalDay !== day) {
      html.push(renderDay(arrivalDay, today, tomorrow));
      day = arrivalDay;
    }
    html.push(renderArrival(arrival, now));
  }
  return html.join("");
}
