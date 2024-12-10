"use server";

import fs from "fs";
import path from "path";
import { Line } from "@/lib/conduent/topography";
import { stopPredictions } from "@/lib/conduent/stop-predictions";
import { MinimalStop, StopData } from "@/types";

function readFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(process.cwd(), "public/_data", file), "utf-8", (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
}

export async function minimalStops(): Promise<MinimalStop[]> {
  return JSON.parse(await readFile("minimal-stops.json"));
}

export async function stopByStopCode(stopCode: string): Promise<StopData> {
  return JSON.parse(await readFile(`stops/${stopCode}.json`));
}

async function lineById(lineId: number): Promise<Line> {
  return JSON.parse(await readFile(`lines/${lineId}.json`));
}

export interface Prediction {
  lineName: string
  lineColor: string
  destinationLabel: string
  scheduledTime: number
  predictedTime: number
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
        predictions.push({
          lineName: line.nomCommercial,
          lineColor: line.couleur,
          destinationLabel: destination.libelle,
          scheduledTime: horaire.horaireApplicable,
          predictedTime: horaire.horaire,
        });
      }
    }
  }

  predictions.sort((a, b) => a.predictedTime - b.predictedTime);
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
