import { Route, Stop, Trip } from "@/types";

/**
 * One scheduled call at a stop, as the feed states it: a time of day on a
 * service, with no date attached.
 *
 * Deliberately timeless. A concrete departure is this crossed with a service
 * date, which depends on when you ask — see expandInstances.
 */
export interface ScheduledCall {
  tripId: string;
  stopId: string;
  sequence: number;
  /** "HH:MM:SS", and may exceed 24:00:00 for trips running past midnight. */
  time: string;
  /**
   * The bus finishes here and does not continue: nobody can board it.
   *
   * A trip's last call is usually not the end of anything — the same vehicle
   * carries on as the next trip in its block, from the same stop, a median of
   * zero minutes later. Those calls are marked `continues` instead. What is
   * flagged here is the real ends: the bus is going to the garage.
   */
  terminates?: boolean;
  /**
   * The trip ends here but the bus does not: it lays over and leaves again as
   * the next trip in its block, from this same stop.
   *
   * Not a departure anyone can board, so `expandInstances` leaves it out of a
   * stop's arrivals — the boardable one is the next trip's first call, and
   * listing both shows a rider two entries for one bus, the first of which
   * turns into "Departed" in front of them.
   *
   * It is kept in the feed rather than dropped because it is still where the
   * trip ends, and a page showing a whole trip has to be able to say so. 1,275
   * of this feed's 1,345 trips end this way; dropping them left 95% of trips
   * one stop short of their own destination.
   */
  continues?: boolean;
}

/**
 * Everything the site needs from a GTFS feed, normalised: names cleaned and
 * disambiguated, routes and trips denormalised where the pages want them, and
 * nothing derived from the current date.
 *
 * This is the artifact a release carries. It is a pure function of the feed,
 * so the same feed always produces the same file, and a release from last week
 * is as usable as one from this morning.
 */
export interface StaticFeed {
  /** The feed's ETag, which is what a build is identified by. */
  feedHash: string | undefined;
  routes: Route[];
  trips: Trip[];
  stops: Stop[];
  calls: ScheduledCall[];
  /** service_id -> the dates it runs, from calendar_dates.txt. */
  serviceDates: Record<string, string[]>;
}
