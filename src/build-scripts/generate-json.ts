import path from "path";
import crypto from "crypto";
import stringify from "json-stable-stringify";

import { topography } from "@/lib/conduent";
import { LineData, StopData } from "@/types";
import { readJSON, writeJSON } from "@/lib/file-utils";
import { fixCapitalization } from "@/lib/capitalization";

interface StaticData {
  stops: Record<string, StopData>
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

  const stops: Record<string, StopData> = {};

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
        lineId: info.idLigne,
        lineName: lineInfo?.lineName || "Unknown",
        lineColor: lineInfo?.lineColor || "#000000",
      };
    });

    const stopName = stopNameOverrides[stop.stopCode] || fixCapitalization(stop.nomCommercial);

    stops[stop.stopCode] = {
      stopId: stop.idPointArret,
      stopName,
      stopCode: stop.stopCode,
      location: stop.localisation,
      lines
    };
  }));

  if (topoData.ligne.length === 0) {
    throw new Error("No ligne data found in topography.");
  }

  return { stops };
}

async function main() {
  const data = await generateStaticData();
  const hash = computeDataHash(data);
  await Promise.all([
    writeJSON('all-stops', Object.values(data.stops)),
    Promise.all(Object.entries(data.stops).map(([stopCode, stopData]) =>
      writeJSON(path.join('stops', stopCode), stopData)
    )),
    writeJSON('data-hash', { hash })
  ]);
  console.log(hash);
}

main().catch(err => {
  console.error('Error generating JSON files:', err);
  process.exit(1);
});

