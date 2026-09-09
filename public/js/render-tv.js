/**
 * @file A stop, as a board to be read from across a room.
 *
 * The third way this project draws the same information, after the stop page
 * and the e-ink panel — and, like the panel, it shares the judgement without
 * sharing the markup. `predictionStatus` decides what may be claimed about a
 * bus and `formatTime` decides how a time is spelled, both imported from
 * render-arrivals.js, so a TV on a wall and a phone in a hand cannot come to
 * different conclusions about whether the 5 is late.
 *
 * What is different here is the reader. The stop page is held at arm's length
 * by someone who has already decided which bus they want, and can scroll; this
 * is glanced at from ten feet away by someone who has decided nothing, and
 * cannot scroll because nobody is going to walk over and touch the television.
 * So the board answers one question — when is the next bus — in the largest
 * type that fits, and shows what follows it only as context.
 *
 * Strictly a string function, for the same reason render-arrivals.js is: no
 * DOM, no browser globals, so it can be tested and, if it ever needs to be,
 * rendered in Node.
 */

import { contrastText } from "./colors.js";
import { escapeHtml } from "./html.js";
import {
  RETAIN_LATE_MS,
  formatTime,
  predictionStatus,
} from "./render-arrivals.js";

/**
 * How many buses the board shows: the next one, large, and what comes after it.
 *
 * "The next arrival or two" is the whole brief, and the temptation is to fill
 * the remaining height with more rows. It should be resisted — a screen that
 * shows eight buses is a timetable, and a timetable is what the stop page is
 * for. The two rows under the hero exist so a reader who has just missed the
 * hero knows whether to wait, not to be read in their own right.
 */
const FOLLOWING = 2;

/**
 * How far ahead a bus is still counted down in minutes rather than named by
 * the clock.
 *
 * Deliberately double render-arrivals.js's thirty. On the page, a countdown
 * past half an hour is noise for a rider who is already standing at the stop.
 * On a board in a cafe or a lobby it is the useful number: "in 48 min" tells
 * someone to order another coffee, where "5:22 pm" makes them do the
 * subtraction themselves, across the room, without a clock to hand.
 */
const COUNTDOWN_WINDOW = 60;

/**
 * The route's colour as a badge, in the same two-tone the stop page's pills
 * use — the feed's own text colour where it supplies one, and a computed
 * contrast where it does not. A near-white route on a dark board is legible as
 * a filled badge in a way it is not as coloured text, which is why the board
 * has no equivalent of the page's `data-too-light` climbdown.
 */
function badge(route, extraClass = "") {
  const background = route.routeColor;
  const text = route.routeTextColor || contrastText(background);
  return [
    `<span class="tv-badge${extraClass ? ` ${extraClass}` : ""}"`,
    ` style="background-color:${escapeHtml(background)};color:${escapeHtml(text)}">`,
    escapeHtml(route.routeShortName),
    `</span>`,
  ].join("");
}

/** Where a bus is going, or that it is not going anywhere. */
function destination(arrival) {
  return arrival.terminates
    ? `<span class="tv-dest tv-dest-ends">ends here</span>`
    : `<span class="tv-dest">to ${escapeHtml(arrival.trip.tripHeadsign)}</span>`;
}

/**
 * The one enormous thing on the screen, as a value and the unit under it.
 *
 * A number of minutes wherever there is one worth reading, because that is
 * what a glance can use. Everything else — a bus at the stop, a bus due now, a
 * bus cancelled, a bus far enough out that the minutes stop meaning anything —
 * is a word or a clock time in the same place, so the eye always lands on the
 * answer rather than hunting for which line is today's.
 */
function headline(prediction) {
  const word = (value, unit, tone) => ({ kind: "word", value, unit, tone });

  if (prediction.skipped) return word("Canceled", "", "warn");
  if (prediction.atStop) return word("Now", "at the stop", "ok");
  if (prediction.minutesAway <= 0) return word("Now", "arriving", "ok");

  if (prediction.minutesAway <= COUNTDOWN_WINDOW) {
    return {
      kind: "minutes",
      value: String(prediction.minutesAway),
      unit: prediction.minutesAway === 1 ? "min" : "mins",
      tone: prediction.tone,
    };
  }

  // Past the window the minutes are worse than the clock: nobody waits an hour
  // and ten by counting it down. `kind` is what stops the callers printing the
  // same clock time twice, once as the headline and once as the detail under
  // it — which is what a row an hour out looked like before this said so.
  return {
    kind: "clock",
    value: formatTime(prediction.predicted),
    unit: "",
    tone: prediction.tone,
  };
}

/**
 * The scheduled time, struck through once something supersedes it, and the
 * word for the difference. The same pair the page shows, at the size of a
 * caption rather than a headline — on a board this is the small print that
 * explains the big number, not the answer itself.
 */
function detail(prediction, kind) {
  const { scheduled, predicted, delta, skipped, message, tone } = prediction;
  const superseded = delta !== 0 || skipped;

  /*
   * Nothing has moved and the headline is already showing this exact clock
   * time, so the times line has nothing left to add.
   */
  const showTimes = superseded || kind !== "clock";

  /*
   * The headline is saying "Canceled" or "Now" in letters a foot high. The
   * badge exists to carry what the big number cannot say — lateness — and
   * where the big slot is already saying it, a second, smaller copy of the
   * same word underneath is just noise.
   */
  const showStatus = message !== null && kind !== "word";

  return [
    showTimes ? `<p class="tv-times">` : "",
    !showTimes
      ? ""
      : superseded
        ? `<span class="tv-time-superseded">${formatTime(scheduled)}</span>`
        : `<span>${formatTime(scheduled)}</span>`,
    showTimes && delta !== 0
      ? `<span class="tv-arrow" aria-hidden="true"></span><span>${formatTime(predicted)}</span>`
      : "",
    showTimes ? `</p>` : "",
    showStatus
      ? `<p class="tv-status" data-status="${tone}">${escapeHtml(message)}</p>`
      : "",
  ].join("");
}

function renderHero({ arrival, prediction }) {
  const { kind, value, unit, tone } = headline(prediction);

  /*
   * Only a word gets the tone. The headline slot is answering "how long", and
   * a count of minutes in the late colour answers a question nobody asked —
   * it reads as an alarm about a bus that is nine minutes away and perfectly
   * catchable. "Canceled" and "Now" are different: there the colour *is* the
   * message. The status badge under the headsign carries lateness either way.
   */
  const heroTone = kind === "word" ? (tone ?? "idle") : "";

  return [
    `<div class="tv-hero"${heroTone ? ` data-tone="${heroTone}"` : ""}>`,
    `<div class="tv-hero-what">`,
    `<h2 class="tv-hero-route">${badge(arrival.route)}${destination(arrival)}</h2>`,
    detail(prediction, kind),
    `</div>`,
    `<div class="tv-hero-when">`,
    // How many characters the stylesheet has to fit. "8" and "Canceled" go in
    // the same slot and cannot be the same size; see .tv-count in tv.css.
    `<span class="tv-count" style="--tv-count-len:${value.length}">${escapeHtml(value)}</span>`,
    unit ? `<span class="tv-count-unit">${escapeHtml(unit)}</span>` : "",
    `</div>`,
    `</div>`,
  ].join("");
}

function renderRow({ arrival, prediction }) {
  const { kind, value, unit } = headline(prediction);

  // A row always names the clock time — it is the one thing that does not go
  // out of date while the board is being read — and adds the countdown beside
  // it only when that is a different fact from the time itself.
  return [
    `<div class="tv-row">`,
    `<span class="tv-row-route">${badge(arrival.route, "tv-badge-sm")}${destination(arrival)}</span>`,
    `<span class="tv-row-time">${formatTime(prediction.predicted)}</span>`,
    kind === "clock"
      ? `<span class="tv-row-count"></span>`
      : `<span class="tv-row-count">${escapeHtml(value)}${unit && kind === "minutes" ? ` <small>${escapeHtml(unit)}</small>` : ""}</span>`,
    `</div>`,
  ].join("");
}

/**
 * A service alert, as a band across the top of the board.
 *
 * The header only. A stop page can afford the description because a rider is
 * holding it and can read a paragraph; at ten feet a paragraph is a grey block
 * nobody finishes, and every line it takes is a line the next bus does not
 * have. GTFS-RT header text is already written to be the whole message — "Stop
 * closed, use Congress St + High St" — so the description is what a reader who
 * wants more opens the stop page for.
 *
 * The severity is on the element rather than in the words, so the stylesheet
 * can make a suspended service look different from an out-of-order lift
 * without the renderer deciding what either of them is worth.
 */
export function renderTvAlert(alert) {
  if (!alert) return "";

  return [
    `<p class="tv-alert" data-severity="${escapeHtml(alert.severity ?? "unknown")}">`,
    escapeHtml(alert.headerText ?? ""),
    `</p>`,
  ].join("");
}

/**
 * The board: the next bus and the couple behind it, or the empty state.
 *
 * Two things happen here that the stop page does not do, and both follow from
 * the hero being enormous.
 *
 * A bus that has gone is dropped rather than kept for a few minutes. The page
 * keeps them because it is read by someone standing at the stop looking at an
 * empty street, for whom "you have just missed it" is the answer. Nobody is
 * standing at this screen — it is on a wall somewhere near the stop — so a
 * departure that has been and gone is only taking up the space the next bus
 * should be in.
 *
 * And the list is re-sorted by when each bus is actually expected. The snapshot
 * arrives in *scheduled* order — see expandInstances — which on the page is
 * fine, because every row is the same size and a reader can see all of them. It
 * is not fine here: a bus scheduled at 7:00 and running twelve minutes late
 * sorts ahead of an on-time 7:05, so the board would put "12 mins" in letters a
 * foot high and leave the bus that is actually coming first in the small print
 * underneath. The hero has to be the soonest bus, because that is what a reader
 * across a room takes the big number to mean.
 */
export function renderTvBoard(arrivals, now = Date.now()) {
  const upcoming = (arrivals || [])
    .map((arrival) => ({ arrival, prediction: predictionStatus(arrival, now) }))
    .filter(({ prediction }) => {
      if (prediction.departed) return false;
      /*
       * The same ninety-minute bound the page applies, and it matters more
       * here. A bus standing at the stop is never "departed", so without this
       * a board left running against a worker that stopped writing would go on
       * announcing "Now — at the stop" for the rest of the evening. The
       * staleness banner says the times are old; the hero should not be
       * shouting a departure that was three hours ago underneath it.
       */
      const { predicted, scheduled } = prediction;
      return now - Math.max(predicted, scheduled) <= RETAIN_LATE_MS;
    })
    .sort((a, b) => a.prediction.predicted - b.prediction.predicted);

  if (upcoming.length === 0) {
    return `<p class="tv-none">No buses due</p>`;
  }

  const [next, ...rest] = upcoming;
  const following = rest.slice(0, FOLLOWING);

  return [
    renderHero(next),
    following.length
      ? `<div class="tv-next">${following.map(renderRow).join("")}</div>`
      : "",
  ].join("");
}
