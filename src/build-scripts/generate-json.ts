import path from "path";
import { topography } from "@/lib/conduent";
import { LineData, MinimalStop, StopData } from "@/types";
import { toProperCase } from "@/lib/utils";
import { absolutePath, readJSON, stopNameOverridesFilename, writeJSON } from "./util";

async function main() {
  const data = await topography();
  const topoData = data.topo[0];

  // Create output directories if needed
  const stopsDir = 'stops';
  const linesDir = 'lines';

  const minimalStopsFile = absolutePath('minimal-stops.json');
  const stopNameOverrides: Record<string, string> = await readJSON(stopNameOverridesFilename, {});

  // Create a lookup map for lines by id
  const lineMap = new Map<number, { lineName: string, lineColor: string }>();
  topoData.ligne.forEach(line => {
    lineMap.set(line.idLigne, {
      lineName: line.nomCommercial || line.libCommercial,
      lineColor: line.couleur
    });
  });

  const minimalStops: MinimalStop[] = [];
  // Generate JSON files for stops with line info enriched
  if (topoData.pointArret) {
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

      const enrichedStop: StopData = {
        stopId: stop.idPointArret,
        stopName: stopNameOverrides[stop.stopCode] || stop.nomCommercial,
        stopCode: stop.stopCode,
        location: stop.localisation,
        lines
      };

      minimalStops.push({
        stopName: toProperCase(stop.nomCommercial),
        stopCode: stop.stopCode,
        location: stop.localisation,
      });

      const filePath = path.join(stopsDir, `${stop.stopCode}.json`);
      await writeJSON(filePath, enrichedStop);
      console.log(`Wrote enriched stop data to ${filePath}`);
    }));
  } else {
    console.warn("No pointArret data found in topography.");
  }
  await writeJSON(minimalStopsFile, minimalStops);

  // Generate JSON files for lines
  if (topoData.ligne) {
    await Promise.all(topoData.ligne.map(async line => {
      const filePath = path.join(linesDir, `${line.idLigne}.json`);
      await writeJSON(filePath, line);
      console.log(`Wrote line data to ${filePath}`);
    }));
  } else {
    console.warn("No ligne data found in topography.");
  }
}

main().catch(err => {
  console.error('Error generating JSON files:', err);
  process.exit(1);
});

