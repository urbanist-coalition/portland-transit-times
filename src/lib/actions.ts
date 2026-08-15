"use server";

import { subMinutes } from "date-fns";
import { Alert, LiveStopTimeInstance, Stop, StopSummary } from "@/types";
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

/**
 * Every stop reduced to just what the search box and quick stops need, keyed by
 * stop id. Roughly a third of the size of the full stop records.
 */
export async function getStopSummaries(): Promise<Record<string, StopSummary>> {
  const stops = await getModel().getStops();
  const summaries: Record<string, StopSummary> = {};
  for (const { stopId, stopCode, stopName } of stops) {
    summaries[stopId] = { stopCode, stopName };
  }
  return summaries;
}

export async function getStop(stopCode: string): Promise<Stop | null> {
  return getModel().getStop(stopCodeToStopId(stopCode));
}
