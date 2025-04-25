"use server";

import { subMinutes } from "date-fns";
import { Alert, LiveStopTimeInstance, RouteWithShape, Stop } from "@/types";
import { getModel } from "@/lib/model";
import { stopCodeToStopId } from "@/lib/utils";

export async function predictionsByStopCode(
  stopCode: string
): Promise<LiveStopTimeInstance[]> {
  return getModel().getStopTimeInstances(
    stopCodeToStopId(stopCode),
    subMinutes(new Date(), 10),
    20
  );
}

export async function getServiceAlerts(): Promise<Alert[]> {
  return getModel().getAlerts();
}

export async function getLines(): Promise<RouteWithShape[]> {
  return await getModel().getRoutes();
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
