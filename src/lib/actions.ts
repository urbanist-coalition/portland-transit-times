"use server";

import {
  LineData,
  LineDataSlim,
  ServiceAlert,
  StopData,
  StopTimeData,
  VehicleData,
} from "@/types";

import model from "@/lib/redis";
import { subMinutes } from "date-fns";

export async function predictionsByStopCode(
  stopCode: string
): Promise<StopTimeData[]> {
  return model.getStopTimes(stopCode, subMinutes(new Date(), 15));
}

export async function getVehicles(): Promise<VehicleData[]> {
  return model.getVehicles();
}

export async function getServiceAlerts(): Promise<ServiceAlert[]> {
  return model.getServiceAlerts();
}

export async function getLinesSlim(): Promise<Record<string, LineDataSlim>> {
  return model.getLinesSlim();
}

export async function getLines(): Promise<Record<string, LineData>> {
  return model.getLines();
}

export async function getStops(): Promise<Record<string, StopData>> {
  return model.getStops();
}

export async function getStop(stopCode: string): Promise<StopData | null> {
  return model.getStop(stopCode);
}

export async function getStopTimes(
  stopCode: string,
  afterTimestamp: Date
): Promise<StopTimeData[]> {
  return model.getStopTimes(stopCode, afterTimestamp);
}
