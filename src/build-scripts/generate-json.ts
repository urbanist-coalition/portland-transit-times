import path from "path";
import crypto from "crypto";
import stringify from "json-stable-stringify";

import { topography } from "@/lib/conduent";
import { StopData, LineData } from "@/types";
import { readJSON, writeJSON } from "@/lib/file-utils";
import { fixCapitalization } from "@/lib/capitalization";
import { locationEquals } from "@/lib/utils";

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
  const lines: Record<string, LineData> = {};
  topoData.ligne.forEach(line => {
    const points = line.itineraire
      .map(i => i.troncons.flatMap(t => [t.debut, t.fin]))
      .map(segment => segment.filter((v, i) => !locationEquals(segment[i - 1], v)));

    lines[String(line.idLigne)] = {
      lineId: line.idLigne,
      lineName: line.nomCommercial || line.libCommercial,
      lineColor: line.couleur,
      points,
    }
  });

  const stops: Record<string, StopData> = {};

  if (topoData.pointArret.length === 0) {
    throw new Error("No pointArret data found in topography.");
  }

  await Promise.all(topoData.pointArret.map(async stop => {
    const stopName = stopNameOverrides[stop.stopCode] || fixCapitalization(stop.nomCommercial);

    stops[stop.stopCode] = {
      stopId: stop.idPointArret,
      stopName,
      stopCode: stop.stopCode,
      location: stop.localisation,
      lineIds: stop.infoLigneSwiv.map(info => info.idLigne),
    };
  }));

  if (topoData.ligne.length === 0) {
    throw new Error("No ligne data found in topography.");
  }

  return { stops, lines };
}

async function main() {
  const data = await generateStaticData();
  const { stops, lines } = data;
  const hash = computeDataHash(data);
  await Promise.all([
    writeJSON('all-stops', stops),
    Promise.all(Object.entries(data.stops).map(([stopCode, stopData]) =>
      writeJSON(path.join('stops', stopCode), stopData)
    )),
    writeJSON('all-lines', lines),
    writeJSON('data-hash', { hash })
  ]);
  console.log(hash);
}

main().catch(err => {
  console.error('Error generating JSON files:', err);
  process.exit(1);
});

