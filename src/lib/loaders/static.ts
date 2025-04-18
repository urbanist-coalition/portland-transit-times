import { LineData, LineDataSlim, StopData, StopTimeData } from "@/types";
import { differenceInDays, parse } from "date-fns";

import { GTFSStatic, StopTime } from "@/lib/gtfs/static";
import { gtfsTimestamp } from "@/lib/gtfs/utils";
import { GTFSSystem } from "@/lib/gtfs/types";
import { Model } from "@/lib/model";

/**
 * Downloads the GTFS, extracts it into a temp directory, reads `trips.txt`,
 * saves data to Redis, and then cleans up the temp folder.
 */
export async function loadStatic(system: GTFSSystem, model: Model) {
  console.log("Loading trip_id -> route_id mapping...");

  const gtfsStatic = new GTFSStatic(system);
  await gtfsStatic.load();

  try {
    const routes = await gtfsStatic.getRoutes();

    await model.setLinesSlim(
      routes.map(
        ({ route_id, route_short_name, route_color }): LineDataSlim => ({
          lineId: route_id,
          lineName: route_short_name,
          lineColor: `#${route_color}`,
        })
      )
    );

    const trips = await gtfsStatic.getTrips();

    await model.setTripRouteID(
      trips.map(({ trip_id, route_id }) => [trip_id, route_id])
    );

    const shapeIdToTripId = new Map<string, string>(
      trips.map((trip) => [trip.shape_id, trip.trip_id])
    );

    const serviceIdToTrips = new Map<string, string[]>();
    for (const trip of trips) {
      const { service_id, trip_id } = trip;
      if (!serviceIdToTrips.has(service_id)) {
        serviceIdToTrips.set(service_id, []);
      }
      serviceIdToTrips.get(service_id)?.push(trip_id);
    }

    const tripIdToDestination = new Map<string, string>(
      trips.map((trip) => [trip.trip_id, trip.trip_headsign])
    );

    const shapes = await gtfsStatic.getShapes();

    const tripIdToShape = new Map<string, [number, number, number][]>();

    for (const shape of shapes) {
      const { shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence } = shape;
      const tripId = shapeIdToTripId.get(shape_id);

      if (!tripId) {
        console.warn(`No tripId found for shape_id: ${shape_id}`);
        continue;
      }

      if (!tripIdToShape.has(tripId)) {
        tripIdToShape.set(tripId, []);
      }

      tripIdToShape
        .get(tripId)
        ?.push([
          parseFloat(shape_pt_lat),
          parseFloat(shape_pt_lon),
          parseFloat(shape_pt_sequence),
        ]);
    }

    const routeLineData = new Map<string, LineData>();
    for (const [tripId, points] of tripIdToShape.entries()) {
      const routeId = await model.getTripRouteID(tripId);
      if (!routeId) {
        console.warn(`No routeId found for tripId: ${tripId}`);
        continue;
      }

      const lineSlim = await model.getLineSlim(routeId);
      if (!lineSlim) {
        console.warn(`No line found for routeId: ${routeId}`);
        continue;
      }

      const linePoints = routeLineData.get(routeId)?.points || [];

      const sortedPoints = points
        .toSorted(([, , seqA], [, , seqB]) => seqA - seqB)
        .map(([lat, lng]) => ({ lat, lng }));

      routeLineData.set(routeId, {
        ...lineSlim,
        points: [...linePoints, sortedPoints],
      });
    }

    await model.setLines(Array.from(routeLineData.values()));

    const stopTimes = await gtfsStatic.getStopTimes();

    const stopRoutes = new Map<string, string[]>();
    const tripIdToStopTimes = new Map<string, StopTime[]>();
    for (const stopTime of stopTimes) {
      const { trip_id, stop_id } = stopTime;
      const routeId = await model.getTripRouteID(trip_id);
      if (!routeId) {
        console.warn(`No routeId found for tripId: ${trip_id}`);
        continue;
      }
      if (!stopRoutes.has(stop_id)) {
        stopRoutes.set(stop_id, []);
      }
      if (!stopRoutes.get(stop_id)?.includes(routeId)) {
        stopRoutes.get(stop_id)?.push(routeId);
      }

      const stopTimeData = tripIdToStopTimes.get(trip_id) || [];
      tripIdToStopTimes.set(trip_id, [...stopTimeData, stopTime]);
    }

    const calendarDates = await gtfsStatic.getCalendarDates();

    const stopTimeData: StopTimeData[] = [];
    for (const calendarDate of calendarDates) {
      const calendarDateDate = parse(calendarDate.date, "yyyyMMdd", new Date());
      if (differenceInDays(calendarDateDate, new Date()) > 3) {
        continue;
      }

      for (const tripId of serviceIdToTrips.get(calendarDate.service_id) ||
        []) {
        for (const stopTime of tripIdToStopTimes.get(tripId) || []) {
          const headsign = tripIdToDestination.get(tripId) || "";
          const routeId = await model.getTripRouteID(tripId);
          if (!routeId) {
            console.warn(`No routeId found for tripId: ${tripId}`);
            continue;
          }
          const lineSlim = await model.getLineSlim(routeId);
          if (!lineSlim) {
            console.warn(`No line found for routeId: ${routeId}`);
            continue;
          }

          const arrivalTime = gtfsTimestamp(
            calendarDate.date,
            stopTime.arrival_time,
            "America/New_York"
          );

          stopTimeData.push({
            serviceDate: calendarDate.date,
            serviceId: calendarDate.service_id,
            tripId: tripId,
            stopId: stopTime.stop_id.slice(2),
            routeId: routeId,
            headsign,
            lineColor: lineSlim.lineColor,
            lineName: lineSlim.lineName,
            scheduledTime: arrivalTime,
            predictedTime: arrivalTime,
          });
        }
      }
    }

    await model.setStopTimes(stopTimeData);

    const stops = await gtfsStatic.getStops();
    const stopData = new Map<string, StopData>();
    for (const stop of stops) {
      const { stop_id, stop_code, stop_name, stop_lat, stop_lon } = stop;
      if (!stop_code) {
        console.warn(`No stop_code found for stop_id: ${stop_id}`);
        continue;
      }

      const lineIds = stopRoutes.get(stop_id) || [];
      const stopDataEntry: StopData = {
        stopId: stop_code,
        stopCode: stop_code,
        stopName: stop_name,
        location: {
          lat: parseFloat(stop_lat),
          lng: parseFloat(stop_lon),
        },
        lineIds,
      };
      stopData.set(stop_id, stopDataEntry);
    }
    await model.setStops(Array.from(stopData.values()));
  } finally {
    await gtfsStatic.cleanup();
  }
}
