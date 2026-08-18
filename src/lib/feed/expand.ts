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
 * A page is bounded twice: at most ARRIVALS_LIMIT rows, and never further than
 * this window. Whichever binds first wins.
 *
 * At the Pulse the row count binds — 40 departures is about nine hours. At a
 * quiet stop the window binds, and three days is where a timetable stops being
 * something a rider is planning around. Measured against this feed, no stop is
 * left with an empty page by the three-day bound, and every stop that can fill
 * 40 rows in three days does.
 *
 * One day back covers departures that have just gone and buses running late.
 */
export const DEFAULT_WINDOW: ExpansionWindow = { back: 1, forward: 3 };

/** Rows a stop page shows. Forty is about 15 KB, or 2 KB over the wire. */
export const ARRIVALS_LIMIT = 40;

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

/** The identity of one running of one trip: which trip, on which service day. */
export const tripKey = (serviceDate: string, tripId: string) =>
  `${serviceDate}:${tripId}`;

/** A call with its place in the trip kept, which the trip pages order by. */
export type TripCallInstance = StopTimeInstance & { sequence: number };

export interface Expansion {
  /** Boardable departures, sorted by time, keyed by stop. */
  byStop: Map<string, StopTimeInstance[]>;
  /**
   * Every call a trip makes, in the order it makes them, keyed by `tripKey`.
   *
   * Includes the calls no stop offers — where a trip ends and the bus carries
   * on as the next one in its block. That is still where the trip ends, and a
   * page showing a whole trip that stopped one short of its own destination
   * would be wrong about the only thing it exists to say.
   */
  byTrip: Map<string, TripCallInstance[]>;
}

/**
 * Every call in the window, indexed the two ways the site reads them: across a
 * stop, and along a trip.
 *
 * One pass and one set of objects, shared between both maps — a call is in
 * both, and building it twice would be twice the memory to say the same thing.
 * Route and trip travel with each instance because that is what the arrivals
 * payload shows and what the renderers read; they are references to the same
 * objects, not copies, so a departure costs a handful of pointers rather than
 * its own flattened row.
 */
export function expandInstances(
  feed: StaticFeed,
  now: number,
  timeZone: string,
  window: ExpansionWindow = DEFAULT_WINDOW
): Expansion {
  const wanted = datesInWindow(now, window);
  const routesById = indexBy(feed.routes, "routeId");
  const callsByTrip = groupBy(feed.calls, "tripId");
  const tripsByService = groupBy(feed.trips, "serviceId");

  // Sorted once here rather than per service date: the feed lists stop times in
  // whatever order it pleases, and a trip page in that order is a bus visiting
  // its stops at random.
  for (const calls of callsByTrip.values()) {
    calls.sort((a, b) => a.sequence - b.sequence);
  }

  const byStop = new Map<string, StopTimeInstance[]>();
  const byTrip = new Map<string, TripCallInstance[]>();

  for (const [serviceId, dates] of Object.entries(feed.serviceDates)) {
    for (const date of dates) {
      if (!wanted.has(date)) continue;

      for (const trip of tripsByService.get(serviceId) || []) {
        const route = routesById.get(trip.routeId);
        if (!route) continue;

        const calls: TripCallInstance[] = [];
        for (const call of callsByTrip.get(trip.tripId) || []) {
          const scheduledTime = gtfsTimestamp(
            date,
            call.time,
            timeZone
          ).getTime();
          const instance: TripCallInstance = {
            serviceDate: date,
            tripId: trip.tripId,
            stopId: call.stopId,
            sequence: call.sequence,
            scheduledTime,
            route,
            trip,
            ...(call.terminates ? { terminates: true } : {}),
          };
          calls.push(instance);

          /*
           * The bus ends this trip here and leaves again as the next one in its
           * block, from this same stop. Both calls in a stop's list would be
           * one bus shown twice, and the first of the two turns into "Departed"
           * while the rider watches it sit there. The boardable half is the
           * next trip's first call, which is in this list already.
           *
           * The call itself is kept above, because it is where the trip ends.
           */
          if (call.continues) continue;

          const atStop = byStop.get(call.stopId) || [];
          atStop.push(instance);
          byStop.set(call.stopId, atStop);
        }
        if (calls.length) byTrip.set(tripKey(date, trip.tripId), calls);
      }
    }
  }

  for (const instances of byStop.values()) {
    instances.sort((a, b) => a.scheduledTime - b.scheduledTime);
  }
  return { byStop, byTrip };
}

/**
 * The next `limit` departures at a stop after `after`.
 *
 * A binary search over the array `expandInstances` already sorted, so a stop
 * page costs a lookup rather than a scan of the day.
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
