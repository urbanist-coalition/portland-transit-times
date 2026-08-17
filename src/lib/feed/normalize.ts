/**
 * @file Turning a GTFS feed into the artifact a release carries.
 *
 * This is the app's own reading of the feed — capitalisation fixed, acronyms
 * kept, stops that share a name disambiguated by where their buses go — and it
 * is a pure function of the feed. No clock, no database, no network. Given the
 * same zip it produces the same bytes, which is what makes a release
 * reproducible and a rollback meaningful.
 *
 * What it deliberately does not do is expand the schedule into dated
 * departures. That depends on when you ask; see expandInstances.
 */

import { GTFSStatic } from "@/lib/gtfs/static";
import { generateStopNameOverrides } from "@/lib/loaders/stop-name-deduplication";
import {
  fixCapitalization,
  normalizeInOutBound,
} from "@/lib/name-normalization";
import { groupBy, indexBy } from "@/lib/utils";
import { Route, Stop, Trip } from "@/types";

import { ScheduledCall, StaticFeed } from "./types";

/**
 * The last stop on a trip, which stands in as its destination when the feed
 * gives no headsign.
 */
function buildLastStopNames(
  callsByTrip: Map<string, { stopId: string; sequence: number }[]>,
  stopNamesById: Map<string, string>
): Map<string, string> {
  const lastStopNames = new Map<string, string>();
  for (const [tripId, calls] of callsByTrip) {
    let last: { stopId: string; sequence: number } | undefined;
    for (const call of calls) {
      if (!last || call.sequence > last.sequence) last = call;
    }
    const name = last && stopNamesById.get(last.stopId);
    if (name) lastStopNames.set(tripId, name);
  }
  return lastStopNames;
}

export async function normalizeFeed(gtfs: GTFSStatic): Promise<StaticFeed> {
  const [rawStops, rawTrips, rawRoutes, rawStopTimes, rawCalendarDates] =
    await Promise.all([
      gtfs.getStops(),
      gtfs.getTrips(),
      gtfs.getRoutes(),
      gtfs.getStopTimes(),
      gtfs.getCalendarDates(),
    ]);

  /*
   * A call is kept whenever the feed gives it a time. The previous loader
   * required arrival_time and departure_time to be equal and dropped the row
   * otherwise, which silently deleted every departure from a stop where a bus
   * waits — 268 of the Pulse's 789 over a typical window, a third of the
   * departures from the busiest stop in the system.
   *
   * Departure is the right one to keep: a rider standing at the stop is
   * boarding, not alighting.
   */
  const calls: ScheduledCall[] = [];
  for (const stopTime of rawStopTimes) {
    const time = stopTime.departure_time || stopTime.arrival_time;
    if (!time) continue;
    calls.push({
      tripId: stopTime.trip_id,
      stopId: stopTime.stop_id,
      sequence: parseInt(stopTime.stop_sequence, 10),
      time,
    });
  }

  /*
   * Trip endings.
   *
   * 942 of this feed's 1,345 trips end where the next trip in their block
   * begins — the bus lays over and carries on, a median of zero minutes later.
   * Listing the ending as well as the departure gives a rider two rows for one
   * bus, and the first turns into "Departed" while they watch. So the ending
   * goes, and the departure it duplicates stays.
   *
   * The other 403 are real: the vehicle finishes there. Those are kept and
   * marked, because a bus arriving is worth knowing about and a bus you cannot
   * board should not be offered as one you can.
   */
  const callsByTripForBlocks = groupBy(calls, "tripId");
  const lastCall = new Map<string, ScheduledCall>();
  const firstCall = new Map<string, ScheduledCall>();
  for (const [tripId, tripCalls] of callsByTripForBlocks) {
    const sorted = [...tripCalls].sort((a, b) => a.sequence - b.sequence);
    if (sorted.length === 0) continue;
    firstCall.set(tripId, sorted[0]!);
    lastCall.set(tripId, sorted[sorted.length - 1]!);
  }

  /*
   * A block is a vehicle's work on *one* service day, so the same block_id
   * appears under Sunday, Saturday and No School with different trips. Ordered
   * across all of them, "the next trip in the block" lands on another day's
   * duty and the layover goes unrecognised — which is how City Hall kept
   * showing the 9A arriving and the 9A leaving as two buses at 11:30.
   */
  const blockOrder = new Map<string, string[]>();
  for (const trip of rawTrips) {
    if (!trip.block_id) continue;
    const duty = `${trip.block_id}\u0000${trip.service_id}`;
    (blockOrder.get(duty) ?? blockOrder.set(duty, []).get(duty)!).push(
      trip.trip_id
    );
  }
  const continuesFrom = new Set<ScheduledCall>();
  const realEndings = new Set<ScheduledCall>();
  for (const tripIds of blockOrder.values()) {
    const ordered = tripIds
      .filter((tripId) => firstCall.has(tripId))
      .sort((a, b) =>
        firstCall.get(a)!.time.localeCompare(firstCall.get(b)!.time)
      );
    for (const [index, tripId] of ordered.entries()) {
      const ending = lastCall.get(tripId);
      if (!ending) continue;
      const next = ordered[index + 1];
      const resumesHere = next && firstCall.get(next)!.stopId === ending.stopId;
      (resumesHere ? continuesFrom : realEndings).add(ending);
    }
  }

  const boardableCalls = calls.filter((call) => !continuesFrom.has(call));
  for (const call of realEndings) call.terminates = true;

  /*
   * Everything derived from the *shape* of a trip — where it ends, which
   * destinations a stop can reach — is computed from every call, including the
   * endings dropped above. A trip that lays over still ends where it ends, and
   * a headsign that falls back to "the last stop's name" must not fall back to
   * the second to last.
   */
  const callsByTrip = groupBy(calls, "tripId");
  const callsByStop = groupBy(calls, "stopId");
  const stopNamesById = new Map(
    rawStops.map(({ stop_id, stop_name }) => [stop_id, stop_name])
  );
  const lastStopNames = buildLastStopNames(callsByTrip, stopNamesById);

  const trips: Trip[] = rawTrips.map(
    ({ service_id, trip_id, route_id, shape_id, trip_headsign }) => ({
      tripId: trip_id,
      routeId: route_id,
      serviceId: service_id,
      shapeId: shape_id,
      tripHeadsign: fixCapitalization(
        trip_headsign || lastStopNames.get(trip_id) || ""
      ),
    })
  );
  const tripsById = indexBy(trips, "tripId");

  const routes: Route[] = rawRoutes.map(
    ({ route_id, route_short_name, route_color, route_text_color }) => ({
      routeId: route_id,
      routeShortName: route_short_name,
      routeColor: `#${route_color}`,
      routeTextColor: `#${route_text_color}`,
    })
  );
  const routesById = indexBy(routes, "routeId");

  const stops: Stop[] = [];
  for (const stop of rawStops) {
    const { stop_id, stop_name, stop_code, stop_lat, stop_lon } = stop;
    // GPMETRO's "1:" stops have no stop times at all; what they are for is
    // unclear, and they are not places anyone waits.
    if (stop_id.startsWith("1")) continue;

    const routeIds = new Set<string>();
    for (const call of callsByStop.get(stop_id) || []) {
      const trip = tripsById.get(call.tripId);
      if (trip) routeIds.add(trip.routeId);
    }

    const stopRoutes: Route[] = [];
    for (const routeId of routeIds) {
      const route = routesById.get(routeId);
      if (route) stopRoutes.push(route);
    }

    // The South Portland stops are in the feed with no service on them.
    if (stopRoutes.length === 0) continue;

    stops.push({
      stopId: stop_id,
      stopCode: stop_code,
      stopName: stop_name,
      location: { lat: parseFloat(stop_lat), lng: parseFloat(stop_lon) },
      routes: stopRoutes,
    });
  }

  // Where several stops share a name, the destinations reachable from each are
  // what tells them apart.
  const headsignsByStopId: Record<string, string[]> = {};
  for (const call of boardableCalls) {
    const trip = tripsById.get(call.tripId);
    // A blank headsign is not a destination; letting it through renames stops
    // to a dangling "Route 1 + Shaws Falmouth ⇨ ".
    if (!trip?.tripHeadsign) continue;
    const current = headsignsByStopId[call.stopId] || [];
    if (!current.includes(trip.tripHeadsign)) {
      headsignsByStopId[call.stopId] = [...current, trip.tripHeadsign];
    }
  }
  const overrides = generateStopNameOverrides(stops, headsignsByStopId);

  const serviceDates: Record<string, string[]> = {};
  for (const { service_id, date, exception_type } of rawCalendarDates) {
    // 1 adds service on a date, 2 removes it.
    if (exception_type !== "1") continue;
    (serviceDates[service_id] ||= []).push(date);
  }
  for (const dates of Object.values(serviceDates)) dates.sort();

  return {
    feedHash: gtfs.hash,
    routes,
    trips,
    stops: stops.map((stop) => ({
      ...stop,
      stopName:
        overrides[stop.stopId] ||
        fixCapitalization(normalizeInOutBound(stop.stopName)),
    })),
    calls: boardableCalls,
    serviceDates,
  };
}
