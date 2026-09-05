/**
 * @file A stop, as 800x480 pixels of ink.
 *
 * This is the panel's equivalent of render-arrivals.js, and it deliberately
 * shares that module's judgement rather than repeating it: `predictionStatus`
 * decides what may be claimed about a bus, and `formatTime` decides how a time
 * is spelled. A panel bolted to a shelter and the page in a rider's hand are
 * the same information, and the two must not be able to disagree about whether
 * a bus is late — which they would within a month if this file made up its own
 * mind about either.
 *
 * What it does not share is markup, because there is none. Where the web page
 * has elements and a stylesheet, this has coordinates.
 */

import { LiveStopTimeInstance, Stop } from "@/types";
import { Bitmap1 } from "./canvas";
import { drawText, measure } from "./font";
import { DisplayProfile } from "./profile";
import {
  formatTime,
  predictionStatus,
} from "../../../public/js/render-arrivals.js";

const MARGIN = 16;
const HEADER_HEIGHT = 78;
const ROW_HEIGHT = 62;
const FOOTER_HEIGHT = 30;

/**
 * How many buses that have already gone are still worth a row.
 *
 * The website keeps ten minutes of them, so a rider who sees an empty street
 * learns they have just missed one rather than assuming the app is broken. The
 * same reasoning applies here and the same answer does not: the page can afford
 * a long list and this has six rows, so a departure that is over takes at most
 * one of them.
 */
const DEPARTED_ROWS = 1;

/** A filled box with its corners knocked off — the route badges. */
function badge(
  target: Bitmap1,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  target.fill(x, y, w, h);
  for (const [cx, cy] of [
    [x, y],
    [x + w - 1, y],
    [x, y + h - 1],
    [x + w - 1, y + h - 1],
  ] as const) {
    target.set(cx, cy, false);
  }
}

/**
 * Chooses the rows, newest departure first.
 *
 * `departures` hands back everything inside its window in time order, which
 * for a panel means the first thing a rider sees could be a bus that left nine
 * minutes ago. So the gone ones are trimmed to the most recent few and the rest
 * of the space goes to buses someone can still catch.
 */
function chooseRows(
  arrivals: LiveStopTimeInstance[],
  now: number,
  limit: number
): LiveStopTimeInstance[] {
  const gone: LiveStopTimeInstance[] = [];
  const coming: LiveStopTimeInstance[] = [];
  for (const arrival of arrivals) {
    (predictionStatus(arrival, now).departed ? gone : coming).push(arrival);
  }
  const kept = gone.slice(-DEPARTED_ROWS);
  return [...kept, ...coming].slice(0, limit);
}

/**
 * Everything the frame will say, as one string.
 *
 * The worker rewrites a panel only when this changes, which is what stops the
 * clock in the footer from driving the whole thing: a frame carrying "as of
 * 4:24 pm" has different pixels every single minute, so comparing rendered
 * bytes would redraw the panel sixty times an hour to move one line of small
 * text — and every one of those redraws is four seconds of flashing.
 *
 * So the comparison is made before the timestamp is applied, on the facts a
 * rider is actually there for. When they change the frame is redrawn and the
 * timestamp comes along with it; when they do not, the panel keeps the frame it
 * has and answers its next poll with a 304.
 */
export function frameKey({ stop, arrivals, now, profile }: StopFrame): string {
  return [
    stop.stopName,
    ...chooseRows(arrivals, now, profile.rows).map((arrival) => {
      const status = predictionStatus(arrival, now);
      return [
        arrival.route.routeShortName,
        arrival.trip.tripHeadsign,
        formatTime(status.predicted),
        status.message ?? "",
      ].join("|");
    }),
  ].join("\n");
}

export interface StopFrame {
  stop: Pick<Stop, "stopCode" | "stopName">;
  arrivals: LiveStopTimeInstance[];
  now: number;
  profile: DisplayProfile;
  /**
   * Whose display this is. Not a URL: the site's hostname is a deploy-time
   * setting, and a panel that names one the deployment does not answer to is
   * worse than a panel that names nobody.
   */
  siteName?: string;
}

export function renderStopDisplay({
  stop,
  arrivals,
  now,
  profile,
  siteName = "UCP Transit Times",
}: StopFrame): Bitmap1 {
  const frame = new Bitmap1(profile.width, profile.height);
  const right = profile.width - MARGIN;

  // Header: the stop, which is the one thing on this panel that is true all day.
  const codeLabel = `STOP ${stop.stopCode}`;
  const codeWidth = measure("small", codeLabel);
  drawText(frame, "small", codeLabel, right, 44, { align: "right" });
  drawText(frame, "title", stop.stopName, MARGIN, 44, {
    max: right - MARGIN - codeWidth - 24,
  });
  frame.rule(MARGIN, HEADER_HEIGHT - 4, profile.width - MARGIN * 2, 3);

  const rows = chooseRows(arrivals, now, profile.rows);

  if (!rows.length) {
    drawText(frame, "row", "No buses due", profile.width / 2, 250, {
      align: "center",
    });
  }

  rows.forEach((arrival, index) => {
    const top = HEADER_HEIGHT + index * ROW_HEIGHT;
    const baseline = top + 38;
    const status = predictionStatus(arrival, now);

    if (index > 0) frame.rule(MARGIN, top, profile.width - MARGIN * 2, 1);

    // Route badge: reversed out, because a route number is what a rider scans
    // for first and ink is the only emphasis a 1-bit panel has.
    const route = arrival.route.routeShortName;
    const width = Math.max(64, measure("badge", route) + 24);
    badge(frame, MARGIN, top + 11, width, 36);
    drawText(frame, "badge", route, MARGIN + width / 2, top + 38, {
      align: "center",
      invert: true,
    });

    const timeLabel = formatTime(status.predicted);
    const timeWidth = measure("time", timeLabel);
    drawText(frame, "time", timeLabel, right, baseline, { align: "right" });

    const textLeft = MARGIN + width + 18;
    drawText(frame, "row", arrival.trip.tripHeadsign, textLeft, baseline, {
      max: right - timeWidth - 24 - textLeft,
    });

    /*
     * Under the time rather than under the destination, because it qualifies
     * the time: "4:14 pm / Departed" is one column saying one thing, where the
     * same words under the headsign crowd the row and read as part of the name.
     *
     * It only appears when the agency actually said something — see
     * predictionStatus. Most rows are the timetable, and say so by staying bare.
     */
    if (status.message) {
      drawText(frame, "small", status.message, right, top + 57, {
        align: "right",
      });
    }
  });

  /*
   * The panel keeps showing whatever was last written to it, and nginx keeps
   * serving the last frame written even if the worker has stopped. So the frame
   * states its own age: a rider can tell a stopped clock from a quiet stop, which
   * is the same reason the site refuses to cache /data/.
   */
  const footer = profile.height - FOOTER_HEIGHT;
  frame.rule(MARGIN, footer, profile.width - MARGIN * 2, 1);
  drawText(frame, "small", `as of ${formatTime(now)}`, MARGIN, footer + 22);
  drawText(frame, "small", siteName, right, footer + 22, { align: "right" });

  return frame;
}
