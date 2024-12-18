"use server";

import { Line } from "@/lib/conduent";
import { stopPredictions } from "@/lib/conduent";
import { MinimalStop, StopData } from "@/types";

import { startOfDay, addSeconds, addDays, compareAsc, differenceInHours } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { readJSON } from "./file-utils";

export async function minimalStops(): Promise<MinimalStop[]> {
  return readJSON("minimal-stops");
}

export async function stopByStopCode(stopCode: string): Promise<StopData> {
  return readJSON(`stops/${stopCode}`);
}

async function lineById(lineId: number): Promise<Line> {
  return readJSON(`lines/${lineId}`);
}

function toDate(secondsFromMidnight: number): Date {
  const timeZone = 'America/New_York';
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
  predictionId: number
  lineName: string
  lineColor: string
  destinationLabel: string
  scheduledTime: Date
  predictedTime: Date
}

export async function predictionsByStopCode(stopCode: string): Promise<Prediction[]> {
  const stop = await stopByStopCode(stopCode);
  const schedule = await stopPredictions(stop.stopId);
  const lines = await Promise.all(stop.lines.map(({ stopId }) => lineById(stopId)));
  const lineMap: Record<number, Line> = lines.reduce((acc, line) => ({ ...acc, [line.idLigne]: line }), {});

  const predictions: Prediction[] = [];
  for (const ligneHoraire of schedule.listeHoraires) {
    const line = lineMap[ligneHoraire.idLigne];
    for (const destination of ligneHoraire.destination) {
      for (const horaire of destination.horaires) {
        // From observing the API it seems that if this is set 0 the bus is not arriving
        //  This could mean it was cancelled, or that it had already arrived but for
        //  whatever reason the API is still returning it.
        if (horaire.etatHoraire === 0) continue;
        predictions.push({
          predictionId: horaire.idHoraire,
          lineName: line.nomCommercial,
          lineColor: line.couleur,
          destinationLabel: destination.libelle,
          scheduledTime: toDate(horaire.horaireApplicable),
          predictedTime: toDate(horaire.horaire),
        });
      }
    }
  }

  predictions.sort(({ scheduledTime: a }, { scheduledTime: b }) => compareAsc(a, b));
  return predictions;
}

export async function getClosestStops(lat: number, lon: number): Promise<[MinimalStop, number][]> {
  const n = 5;
  const stops = await minimalStops();

  const R = 6371000; // Earth radius in meters
  const toRadians = (deg: number) => deg * (Math.PI / 180);

  function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in meters
  }

  const closestStops = stops
    .map(stop => [stop, distance(lat, lon, stop.location.lat, stop.location.lng)] as [MinimalStop, number])
    .sort((a, b) => a[1] - b[1]);
  return closestStops.slice(0, n);
}
