"use server";

import { stopPredictions } from "@/lib/conduent";
import { VehicleData } from "@/types";

import {
  startOfDay,
  addSeconds,
  addDays,
  compareAsc,
  differenceInHours,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { fixCapitalization } from "@/lib/capitalization";
import { allStops } from "@/data/all-stops";
import { allLinesSlim } from "@/data/all-lines-slim";
import { getRedisClient } from "./redis";

function toDate(secondsFromMidnight: number): Date {
  const timeZone = "America/New_York";
  const now = toZonedTime(new Date(), timeZone);
  const midnight = fromZonedTime(startOfDay(now), timeZone);
  const date = addSeconds(midnight, secondsFromMidnight);

  // HACK: Normally, if a date is in the past that means it is actually
  // the next day. However, in some cases the API returns a time that is
  // actually in the past this is a particular problem if the predicted time
  // is in the past but the actual time is in the future or visa versa.
  // If one of these gets pushed to the next day it will put a day of time
  // in between the predicted and actual time. Arrivals in the next day should
  // be WAY in the past so this two hour grace period should handle most cases.
  const hourDelta = differenceInHours(date, now);
  if (hourDelta < -2) return addDays(date, 1);
  return date;
}

export interface Prediction {
  predictionId: number;
  lineName: string;
  lineColor: string;
  destinationLabel: string;
  scheduledTime: Date;
  predictedTime: Date;
}

export async function predictionsByStopCode(
  stopCode: string
): Promise<Prediction[]> {
  const stop = allStops[stopCode];

  if (!stop) {
    throw new Error(`No stop found with code ${stopCode}`);
  }

  const schedule = await stopPredictions(stop.stopId);

  const predictions: Prediction[] = [];
  for (const ligneHoraire of schedule.listeHoraires) {
    const line = allLinesSlim[String(ligneHoraire.idLigne)];
    if (!line) {
      console.warn(`No line data for line ${ligneHoraire.idLigne}`);
      continue;
    }

    for (const destination of ligneHoraire.destination) {
      for (const horaire of destination.horaires) {
        // From observing the API it seems that if this is set 0 the bus is not arriving
        //  This could mean it was cancelled, or that it had already arrived but for
        //  whatever reason the API is still returning it.
        if (horaire.etatHoraire === 0) continue;
        predictions.push({
          predictionId: horaire.idHoraire,
          lineName: line.lineName,
          lineColor: line.lineColor,
          destinationLabel: fixCapitalization(destination.libelle),
          scheduledTime: toDate(horaire.horaireApplicable),
          predictedTime: toDate(horaire.horaire),
        });
      }
    }
  }

  predictions.sort(({ scheduledTime: a }, { scheduledTime: b }) =>
    compareAsc(a, b)
  );
  return predictions;
}

export async function getVehicles(): Promise<VehicleData[]> {
  const redis = getRedisClient();
  const cachedVehicles = await redis.get("vehicles");
  return cachedVehicles ? JSON.parse(cachedVehicles) : [];
}
