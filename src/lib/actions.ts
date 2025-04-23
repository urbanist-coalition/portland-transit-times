"use server";

import { subMinutes } from "date-fns";
import {
  Alert,
  LiveStopTimeInstance,
  RouteWithShape,
  Stop,
  VehiclePosition,
  getModel,
} from "@/lib/model";
import { stopCodeToStopId } from "@/lib/utils";

export async function predictionsByStopCode(
  stopCode: string
): Promise<LiveStopTimeInstance[]> {
  return getModel().getStopTimeInstances(
    stopCodeToStopId(stopCode),
    // TODO: subtract minutes once departed UX is implemented
    subMinutes(new Date(), 0),
    20
  );
}

export async function getVehicles(): Promise<VehiclePosition[]> {
  return getModel().getVehiclePositions();
}

export async function getServiceAlerts(): Promise<Alert[]> {
  return getModel().getAlerts();
}

export async function getLines(): Promise<Record<string, RouteWithShape>> {
  const routes = await getModel().getRoutes();
  const routesRecord: Record<string, RouteWithShape> = {};
  for (const route of routes) {
    routesRecord[route.routeId] = route;
  }
  return routesRecord;
}

export async function getStops(): Promise<Record<string, Stop>> {
  const stops = await getModel().getStops();
  const stopsRecord: Record<string, Stop> = {};
  for (const stop of stops) {
    stopsRecord[stop.stopId] = stop;
  }
  return stopsRecord;
}

export async function getStop(stopCode: string): Promise<Stop | null> {
  return getModel().getStop(stopCodeToStopId(stopCode));
}
