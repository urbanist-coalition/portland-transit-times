import path from "path";
import crypto from "crypto";
import stringify from "json-stable-stringify";

import { Line, topography } from "@/lib/conduent";
import { LineData, MinimalStop, StopData } from "@/types";
import { toProperCase } from "@/lib/utils";
import { readJSON, writeJSON } from "@/lib/file-utils";

interface StaticData {
  minimalStops: MinimalStop[];
  stops: Record<string, StopData>
  lines: Record<string, Line>
}

function computeDataHash(staticData: StaticData): string {
  const str = stringify(staticData);
  if (!str) {
    throw new Error("Failed to stringify static data.");
  }
  return crypto.createHash('sha256').update(str).digest('hex')
}

async function generateStaticData() {
  const data = await topography();
  const topoData = data.topo[0];

  const stopNameOverrides: Record<string, string> = await readJSON("stop-name-overrides", {});

  // Create a lookup map for lines by id
  const lineMap = new Map<number, { lineName: string, lineColor: string }>();
  topoData.ligne.forEach(line => {
    lineMap.set(line.idLigne, {
      lineName: line.nomCommercial || line.libCommercial,
      lineColor: line.couleur
    });
  });

  const minimalStops: MinimalStop[] = [];
  const stops: Record<string, StopData> = {};
  const lines: Record<string, Line> = {};

  if (topoData.pointArret.length === 0) {
    throw new Error("No pointArret data found in topography.");
  }

  await Promise.all(topoData.pointArret.map(async stop => {
    // Enrich the stop with line details
    const lines: LineData[] = (stop.infoLigneSwiv || []).map(info => {
      const lineInfo = lineMap.get(info.idLigne);
      if (!lineInfo) {
        throw new Error(`Line info not found for id ${info.idLigne}`);
      }
      return {
        stopId: info.idLigne,
        lineName: lineInfo?.lineName || "Unknown",
        lineColor: lineInfo?.lineColor || "#000000",
      };
    });

    const stopName = stopNameOverrides[stop.stopCode] || toProperCase(stop.nomCommercial);

    const enrichedStop: StopData = {
      stopId: stop.idPointArret,
      stopName,
      stopCode: stop.stopCode,
      location: stop.localisation,
      lines
    };

    minimalStops.push({
      stopName,
      stopCode: stop.stopCode,
      location: stop.localisation,
    });

    stops[stop.stopCode] = enrichedStop;
  }));

  if (topoData.ligne.length === 0) {
    throw new Error("No ligne data found in topography.");
  }

  await Promise.all(topoData.ligne.map(async line => {
    lines[String(line.idLigne)] = line;
  }));

  return { minimalStops, stops, lines };
}

async function main() {
  const data = await generateStaticData();
  const hash = computeDataHash(data);
  await Promise.all([
    writeJSON('minimal-stops', data.minimalStops),
    Promise.all(Object.entries(data.stops).map(([stopCode, stopData]) =>
      writeJSON(path.join('stops', stopCode), stopData)
    )),
    Promise.all(Object.entries(data.lines).map(([lineId, lineData]) =>
      writeJSON(path.join('lines', lineId), lineData)
    )),
    writeJSON('data-hash', { hash })
  ]);
  console.log(hash);
}

main().catch(err => {
  console.error('Error generating JSON files:', err);
  process.exit(1);
});

