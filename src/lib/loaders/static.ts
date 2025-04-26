import { differenceInDays, parse, subDays } from "date-fns";

import { GTFSStatic } from "@/lib/gtfs/static";
import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { GTFSSystem } from "@/lib/gtfs/types";
import { Stop, Route, Location, StopTimeInstance } from "@/types";
import { Model } from "@/lib/model";
import { fixCapitalization } from "@/lib/capitalization";
import { indexBy, groupBy } from "@/lib/utils";
import { generateStopNameOverrides } from "./stop-name-deduplication";

/**
 * Downloads the GTFS, extracts it into a temp directory, reads `trips.txt`,
 * saves data to Redis, and then cleans up the temp folder.
 */
export async function loadStatic(system: GTFSSystem, model: Model) {
  const gtfsStatic = new GTFSStatic(system);
  await gtfsStatic.load();

  try {
    console.log("Loading trips...");
    const trips = await gtfsStatic.getTrips();
    const tripsData = trips.map(
      ({ service_id, trip_id, route_id, shape_id, trip_headsign }) => ({
        tripId: trip_id,
        routeId: route_id,
        serviceId: service_id,
        shapeId: shape_id,
        tripHeadsign: fixCapitalization(trip_headsign),
      })
    );
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

    console.log("Building stop times...");
    const stopTimes = await gtfsStatic.getStopTimes();
    const stopTimesByStopId = groupBy(stopTimes, "stop_id");

    console.log("Loading stops...");
    const stops = await gtfsStatic.getStops();

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
        stopNameOverrides[stop.stopId] || fixCapitalization(stop.stopName),
    }));
    await model.setStops(renamedStopsData);

    console.log("Loading stop time instances...");
    const calendarDates = await gtfsStatic.getCalendarDates();

    const tripsByServiceId = groupBy(tripsData, "serviceId");
    const stopTimesByTripId = groupBy(stopTimes, "trip_id");

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
        for (const { stop_id, arrival_time } of tripStopTimes) {
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
  } finally {
    await gtfsStatic.cleanup();
  }
}
