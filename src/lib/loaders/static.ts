import { differenceInDays, parse } from "date-fns";

import { GTFSStatic, StopTime } from "@/lib/gtfs/static";
import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { GTFSSystem } from "@/lib/gtfs/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Location } from "@/types";
import { concurrentWindow } from "../utils";

/**
 * Downloads the GTFS, extracts it into a temp directory, reads `trips.txt`,
 * saves data to Redis, and then cleans up the temp folder.
 */
export async function loadStatic(system: GTFSSystem) {
  const gtfsStatic = new GTFSStatic(system);
  await gtfsStatic.load();

  try {
    const before = new Date();

    console.log("Loading stops...");
    const stops = await gtfsStatic.getStops();
    const stopsData: Prisma.StopCreateInput[] = [];
    for (const stop of stops) {
      const { stop_id, stop_name, stop_code, stop_lat, stop_lon } = stop;
      // TODO: come up with a more general way of dealing with stops
      //   Currently in GPMETRO, stops starting with 1: have no associated stop times
      //   It is unclear what they are for, at first I thought they were to do
      //   with the South Portland merger but the South Portland stops also have 0: versions
      if (stop_id.startsWith("1")) continue; // Skip the 1: stops
      stopsData.push({
        stopId: stop_id,
        stopCode: stop_code,
        stopName: stop_name,
        location: {
          lat: parseFloat(stop_lat),
          lng: parseFloat(stop_lon),
        },
      });
    }

    for (const stop of stopsData) {
      await prisma.stop.upsert({
        where: { stopId: stop.stopId },
        update: stop,
        create: stop,
      });
    }

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
    const trips = await gtfsStatic.getTrips();
    for (const trip of trips) {
      const { route_id, shape_id } = trip;
      const current = shapesByRouteId.get(route_id) || [];
      if (!current.includes(shape_id)) {
        shapesByRouteId.set(route_id, [...current, shape_id]);
      }
    }

    console.log("Loading routes...");
    const routes = await gtfsStatic.getRoutes();
    const routesData = routes.map(
      ({ route_id, route_short_name, route_color, route_text_color }) => ({
        routeId: route_id,
        routeShortName: route_short_name,
        routeColor: `#${route_color}`,
        routeTextColor: `#${route_text_color}`,
        shapes: (shapesByRouteId.get(route_id) || []).map(
          (shapeId) => sortedShapesById.get(shapeId) || []
        ),
      })
    );

    for (const route of routesData) {
      await prisma.route.upsert({
        where: { routeId: route.routeId },
        update: route,
        create: route,
      });
    }

    console.log("Loading trips...");
    const tripData = trips.map(({ trip_id, route_id, trip_headsign }) => ({
      tripId: trip_id,
      routeId: route_id,
      tripHeadsign: trip_headsign,
    }));

    for (const trip of tripData) {
      await prisma.trip.upsert({
        where: { tripId: trip.tripId },
        update: trip,
        create: trip,
      });
    }

    console.log("Loading stop times...");
    const stopTimes = await gtfsStatic.getStopTimes();
    const stopTimeData = stopTimes.map(({ trip_id, stop_id }) => ({
      tripId: trip_id,
      stopId: stop_id,
    }));
    await concurrentWindow(stopTimeData, 100, async (stopTime) => {
      await prisma.stopTime.upsert({
        where: {
          stopId_tripId: {
            tripId: stopTime.tripId,
            stopId: stopTime.stopId,
          },
        },
        update: stopTime,
        create: stopTime,
      });
    });

    console.log("Loading stop time instances...");
    const calendarDates = await gtfsStatic.getCalendarDates();

    const serviceIdToTrips = new Map<string, string[]>();
    for (const trip of trips) {
      const { service_id, trip_id } = trip;
      const current = serviceIdToTrips.get(service_id) || [];
      serviceIdToTrips.set(service_id, [...current, trip_id]);
    }

    const tripIdToStopTimes = new Map<string, StopTime[]>();
    for (const stopTime of stopTimes) {
      const current = tripIdToStopTimes.get(stopTime.trip_id) || [];
      tripIdToStopTimes.set(stopTime.trip_id, [...current, stopTime]);
    }

    for (const calendarDate of calendarDates) {
      const calendarDateDate = parse(calendarDate.date, "yyyyMMdd", new Date());
      // Only load the next 3 days
      if (differenceInDays(calendarDateDate, new Date()) > 3) {
        continue;
      }

      for (const tripId of serviceIdToTrips.get(calendarDate.service_id) ||
        []) {
        const tripStopTimes = tripIdToStopTimes.get(tripId) || [];
        await Promise.all(
          tripStopTimes.map(async (stopTime) => {
            const { stop_id } = stopTime;
            const time = gtfsTimestamp(
              calendarDate.date,
              stopTime.arrival_time,
              system.timeZone
            );

            await prisma.stopTimeInstance.upsert({
              where: {
                serviceDate_tripId_stopId: {
                  serviceDate: calendarDate.date,
                  tripId,
                  stopId: stop_id,
                },
              },
              update: {
                serviceDate: calendarDate.date,
                tripId,
                stopId: stop_id,
                scheduledArrival: time,
              },
              create: {
                serviceDate: calendarDate.date,
                tripId,
                stopId: stop_id,
                scheduledArrival: time,
                estimatedArrival: time,
              },
            });
          })
        );
      }
    }

    await prisma.stop.deleteMany({
      where: {
        updatedAt: {
          lte: before,
        },
      },
    });
    await prisma.route.deleteMany({
      where: {
        updatedAt: {
          lte: before,
        },
      },
    });
    await prisma.trip.deleteMany({
      where: {
        updatedAt: {
          lte: before,
        },
      },
    });
    await prisma.stopTime.deleteMany({
      where: {
        updatedAt: {
          lte: before,
        },
      },
    });
    await prisma.stopTimeInstance.deleteMany({
      where: {
        updatedAt: {
          lte: before,
        },
      },
    });
  } finally {
    await gtfsStatic.cleanup();
  }
}
