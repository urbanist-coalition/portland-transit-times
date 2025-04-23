import { differenceInDays, parse, subDays } from "date-fns";

import { GTFSStatic } from "@/lib/gtfs/static";
import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { GTFSSystem } from "@/lib/gtfs/types";
import { Stop, Route, Model, Location, StopTimeInstance } from "@/lib/model";

function indexBy<T, K extends keyof T>(array: T[], key: K): Map<T[K], T[]> {
  const index = new Map<T[K], T[]>();
  for (const item of array) {
    const current = index.get(item[key]) || [];
    index.set(item[key], [...current, item]);
  }
  return index;
}

function getOne<T, K>(index: Map<K, T[]>, key: K): T | undefined {
  return (index.get(key) || [])[0];
}

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
        tripHeadsign: trip_headsign,
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
    const stopTimesByStopId = indexBy(stopTimes, "stop_id");

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
        const trip = getOne(tripsById, stopTime.trip_id);
        if (!trip) {
          console.warn("Missing trip", stopTime.trip_id);
          continue;
        }
        routeIds.add(trip.routeId);
      }

      const routes: Route[] = [];
      for (const routeId of routeIds) {
        const route = getOne(routesById, routeId);
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
    await model.setStops(stopsData);

    console.log("Loading stop time instances...");
    const calendarDates = await gtfsStatic.getCalendarDates();

    const tripsByServiceId = indexBy(tripsData, "serviceId");
    const stopTimesByTripId = indexBy(stopTimes, "trip_id");

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
        const route = getOne(routesById, routeId);
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
