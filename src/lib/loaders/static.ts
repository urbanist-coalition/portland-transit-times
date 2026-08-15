import { differenceInDays, parse, subDays } from "date-fns";

import { GTFSStatic, StopTime } from "@/lib/gtfs/static";
import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { GTFSSystem } from "@/lib/gtfs/types";
import { Stop, Route, Location, StopTimeInstance } from "@/types";
import { Model } from "@/lib/model";
import {
  fixCapitalization,
  normalizeInOutBound,
} from "@/lib/name-normalization";
import { indexBy, groupBy } from "@/lib/utils";
import { generateStopNameOverrides } from "@/lib/loaders/stop-name-deduplication";

let hash: string | undefined = undefined;

/**
 * Maps each trip to the name of its final stop.
 *
 * GPMETRO leaves trip_headsign blank for entire directions of some routes
 * (as of writing: all 53 inbound trips on the 7, both directions of the 8,
 * and parts of the 2, 4 and 24B — 196 of 1345 trips). Those render as a
 * dangling "7 to " in the UI, so we fall back to the last stop on the trip.
 *
 * This matches how the agency labels the headsigns it does populate: every
 * non-blank headsign in the feed is either the final stop's name exactly or
 * an abbreviation of it ("QUIMBY & SACO" for "QUIMBY AVE + SACO ST"). None
 * of them name a different place.
 */
function buildLastStopNames(
  stopTimesByTripId: Map<string, StopTime[]>,
  stopNamesById: Map<string, string>
): Map<string, string> {
  const lastStopNames = new Map<string, string>();
  for (const [tripId, tripStopTimes] of stopTimesByTripId.entries()) {
    let lastStopTime: StopTime | undefined;
    for (const stopTime of tripStopTimes) {
      if (
        !lastStopTime ||
        parseInt(stopTime.stop_sequence) > parseInt(lastStopTime.stop_sequence)
      ) {
        lastStopTime = stopTime;
      }
    }
    const stopName = lastStopTime && stopNamesById.get(lastStopTime.stop_id);
    if (stopName) {
      lastStopNames.set(tripId, stopName);
    }
  }
  return lastStopNames;
}

/**
 * Downloads the GTFS, extracts it into a temp directory, reads `trips.txt`,
 * saves data to Redis, and then cleans up the temp folder.
 */
export async function loadStatic(system: GTFSSystem, model: Model) {
  await using gtfsStatic = await GTFSStatic.create(system, hash);
  if (!gtfsStatic.changed) {
    console.log("GTFS static data has not changed, skipping load");
    return;
  }

  if (!(await gtfsStatic.hasRequiredData())) {
    console.warn("GTFS static data is missing required data, skipping load");
    return;
  }

  console.log("Building stop times...");
  const stopTimes = await gtfsStatic.getStopTimes();
  const stopTimesByStopId = groupBy(stopTimes, "stop_id");
  const stopTimesByTripId = groupBy(stopTimes, "trip_id");

  console.log("Loading stops...");
  const stops = await gtfsStatic.getStops();
  const stopNamesById = new Map(
    stops.map(({ stop_id, stop_name }) => [stop_id, stop_name])
  );

  console.log("Loading trips...");
  const trips = await gtfsStatic.getTrips();
  const lastStopNames = buildLastStopNames(stopTimesByTripId, stopNamesById);
  const tripsData = trips.map(
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
  const missingHeadsigns = tripsData.filter(
    ({ tripHeadsign }) => !tripHeadsign
  );
  if (missingHeadsigns.length > 0) {
    console.warn(
      `${missingHeadsigns.length} trips have no headsign and no final stop to fall back to`,
      missingHeadsigns.map(({ tripId }) => tripId)
    );
  }
  await model.setTrips(tripsData);

  console.log("Building route shapes...");
  const shapes = await gtfsStatic.getShapes();
  const shapesById = new Map<string, [number, number, number][]>();
  for (const shape of shapes) {
    const { shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence } = shape;

    if (!shapesById.has(shape_id)) {
      shapesById.set(shape_id, []);
    }

    shapesById
      .get(shape_id)
      ?.push([
        parseFloat(shape_pt_lat),
        parseFloat(shape_pt_lon),
        parseFloat(shape_pt_sequence),
      ]);
  }
  const sortedShapesById = new Map<string, Location[]>();
  for (const [shapeId, shape] of shapesById.entries()) {
    sortedShapesById.set(
      shapeId,
      shape
        .toSorted(([, , seqA], [, , seqB]) => seqA - seqB)
        .map(([lat, lng]) => ({ lat, lng }))
    );
  }

  const shapesByRouteId = new Map<string, string[]>();
  for (const trip of trips) {
    const { route_id, shape_id } = trip;
    const current = shapesByRouteId.get(route_id) || [];
    if (!current.includes(shape_id)) {
      shapesByRouteId.set(route_id, [...current, shape_id]);
    }
  }

  console.log("Loading routes...");
  const routes = await gtfsStatic.getRoutes();
  const routesData: Route[] = routes.map(
    ({ route_id, route_short_name, route_color, route_text_color }) => ({
      routeId: route_id,
      routeShortName: route_short_name,
      routeColor: `#${route_color}`,
      routeTextColor: `#${route_text_color}`,
    })
  );
  const routesWithShapesData = routesData.map((route) => ({
    ...route,
    shapes: (shapesByRouteId.get(route.routeId) || []).map(
      (shapeId) => sortedShapesById.get(shapeId) || []
    ),
  }));
  await model.setRoutes(routesWithShapesData);
  const routesById = indexBy(routesData, "routeId");

  const tripsById = indexBy(tripsData, "tripId");

  const stopsData: Stop[] = [];
  for (const stop of stops) {
    const { stop_id, stop_name, stop_code, stop_lat, stop_lon } = stop;
    // TODO: come up with a more general way of dealing with stops
    //   Currently in GPMETRO, stops starting with 1: have no associated stop times
    //   It is unclear what they are for, at first I thought they were to do
    //   with the South Portland merger but the South Portland stops also have 0: versions
    if (stop_id.startsWith("1")) continue; // Skip the 1: stops

    const routeIds = new Set<string>();
    for (const stopTime of stopTimesByStopId.get(stop_id) || []) {
      const trip = tripsById.get(stopTime.trip_id);
      if (!trip) {
        console.warn("Missing trip", stopTime.trip_id);
        continue;
      }
      routeIds.add(trip.routeId);
    }

    const routes: Route[] = [];
    for (const routeId of routeIds) {
      const route = routesById.get(routeId);
      if (!route) {
        console.warn("Missing route", routeId);
        continue;
      }
      routes.push(route);
    }

    // Weirdly, the South Portland stops are in but they have no associated routes
    if (routes.length === 0) {
      continue;
    }

    stopsData.push({
      stopId: stop_id,
      stopCode: stop_code,
      stopName: stop_name,
      location: {
        lat: parseFloat(stop_lat),
        lng: parseFloat(stop_lon),
      },
      routes,
    });
  }

  const headsignsByStopId: Record<string, string[]> = {};
  for (const stopTime of stopTimes) {
    const { stop_id, trip_id } = stopTime;
    const trip = tripsById.get(trip_id);
    if (!trip) {
      console.warn("Missing trip", trip_id);
      continue;
    }
    const { tripHeadsign } = trip;
    // A blank headsign is not a destination. Letting it through renames stops
    // to a dangling "Route 1 + Shaws Falmouth ⇨ " in the deduplication rules.
    if (!tripHeadsign) continue;
    const current = headsignsByStopId[stop_id] || [];
    if (!current.includes(tripHeadsign)) {
      headsignsByStopId[stop_id] = [...current, tripHeadsign];
    }
  }

  const stopNameOverrides = generateStopNameOverrides(
    stopsData,
    headsignsByStopId
  );
  const renamedStopsData = stopsData.map((stop) => ({
    ...stop,
    stopName:
      stopNameOverrides[stop.stopId] ||
      fixCapitalization(normalizeInOutBound(stop.stopName)),
  }));
  await model.setStops(renamedStopsData);

  console.log("Loading stop time instances...");
  const calendarDates = await gtfsStatic.getCalendarDates();

  const tripsByServiceId = groupBy(tripsData, "serviceId");

  const stopTimeInstanceData: StopTimeInstance[] = [];
  for (const { date, service_id } of calendarDates) {
    const calendarDateDate = parse(date, "yyyyMMdd", new Date());
    // Only load the next 3 days
    if (differenceInDays(calendarDateDate, new Date()) > 3) {
      continue;
    }

    const tripIds = tripsByServiceId.get(service_id) || [];
    for (const trip of tripIds) {
      const { tripId, routeId } = trip;
      const route = routesById.get(routeId);
      if (!route) {
        console.warn("Missing route", routeId);
        continue;
      }

      const tripStopTimes = stopTimesByTripId.get(tripId) || [];
      for (const { stop_id, arrival_time, departure_time } of tripStopTimes) {
        if (
          !arrival_time ||
          !departure_time ||
          arrival_time !== departure_time
        ) {
          continue;
        }
        const time = gtfsTimestamp(
          date,
          arrival_time,
          system.timeZone
        ).getTime();

        stopTimeInstanceData.push({
          serviceDate: date,
          tripId,
          stopId: stop_id,
          scheduledTime: time,
          route,
          trip,
        });
      }
    }
  }
  await model.setStopTimeInstances(stopTimeInstanceData);
  await model.cleanupStopTimeInstances(subDays(new Date(), 3));
  hash = gtfsStatic.hash;
}
