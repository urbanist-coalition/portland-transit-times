/**
 * @file Crossing the schedule with the calendar to get dated departures.
 *
 * This is the one step that depends on when you ask, which is why it is not
 * part of the release: a release is a pure function of the feed and stays
 * valid for as long as the feed does, while an expansion is only about the
 * days around now.
 *
 * The clock is a parameter rather than a call to `new Date()` inside the loop.
 * The previous version read the current time in three places and rebuilt the
 * window only when the *feed* changed — so a feed that went unchanged for more
 * than three days left the app with no upcoming departures at all, and no test
 * could state the window it was testing.
 */

import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { groupBy, indexBy } from "@/lib/utils";
import { StopTimeInstance } from "@/types";

import { StaticFeed } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpansionWindow {
  /** Days of already-departed service to keep, for stops running late. */
  back: number;
  /** Days of upcoming service to publish. */
  forward: number;
}

/**
 * Seven days forward covers 40 departures at 647 of 656 stops, and doubles as
 * the sensible bound on how far ahead a page will ever look: at the Pulse 40
 * departures is nine hours, and at a stop with three buses a day it is most of
 * a week, which is where a timetable stops being useful anyway. Fourteen days
 * would fill eight more stops for twice the memory and twice the expansion.
 *
 * One day back is for departures that have just gone and buses running late.
 */
export const DEFAULT_WINDOW: ExpansionWindow = { back: 1, forward: 7 };

function dateKey(epochMs: number): string {
  const date = new Date(epochMs);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

/** The service dates within `window` of `now`, as GTFS "YYYYMMDD" strings. */
export function datesInWindow(
  now: number,
  window: ExpansionWindow
): Set<string> {
  const dates = new Set<string>();
  for (let day = -window.back; day <= window.forward; day++) {
    dates.add(dateKey(now + day * DAY_MS));
  }
  return dates;
}

/**
 * Every departure in the window, sorted by time, keyed by stop.
 *
 * Route and trip travel with each instance because that is what the arrivals
 * payload shows and what the renderer reads; they are references to the same
 * objects, not copies, so this costs pointers rather than the 470 bytes a row
 * took in Redis.
 */
export function expandInstances(
  feed: StaticFeed,
  now: number,
  timeZone: string,
  window: ExpansionWindow = DEFAULT_WINDOW
): Map<string, StopTimeInstance[]> {
  const wanted = datesInWindow(now, window);
  const routesById = indexBy(feed.routes, "routeId");
  const callsByTrip = groupBy(feed.calls, "tripId");
  const tripsByService = groupBy(feed.trips, "serviceId");

  const byStop = new Map<string, StopTimeInstance[]>();

  for (const [serviceId, dates] of Object.entries(feed.serviceDates)) {
    for (const date of dates) {
      if (!wanted.has(date)) continue;

      for (const trip of tripsByService.get(serviceId) || []) {
        const route = routesById.get(trip.routeId);
        if (!route) continue;

        for (const call of callsByTrip.get(trip.tripId) || []) {
          const scheduledTime = gtfsTimestamp(
            date,
            call.time,
            timeZone
          ).getTime();
          const instances = byStop.get(call.stopId) || [];
          instances.push({
            serviceDate: date,
            tripId: trip.tripId,
            stopId: call.stopId,
            scheduledTime,
            route,
            trip,
          });
          byStop.set(call.stopId, instances);
        }
      }
    }
  }

  for (const instances of byStop.values()) {
    instances.sort((a, b) => a.scheduledTime - b.scheduledTime);
  }
  return byStop;
}

/**
 * The next `limit` departures at a stop after `after`.
 *
 * A binary search over the sorted array — the job the 656 Redis sorted sets
 * were doing.
 */
export function departuresAfter(
  instances: StopTimeInstance[],
  after: number,
  limit: number
): StopTimeInstance[] {
  let low = 0;
  let high = instances.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (instances[middle]!.scheduledTime < after) low = middle + 1;
    else high = middle;
  }
  return instances.slice(low, low + limit);
}
