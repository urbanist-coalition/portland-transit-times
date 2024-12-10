import fs from "fs";
import path from "path";
import { topography } from "@/lib/conduent/topography";
import { LineData, MinimalStop, StopData } from "@/types";
import { toProperCase } from "@/lib/utils";

async function main() {
  const data = await topography();
  const topoData = data.topo[0];

  // Create output directories if needed
  const stopsDir = path.join(process.cwd(), "_data", 'stops');
  const linesDir = path.join(process.cwd(), "_data", 'lines');

  const minimalStopsFile = path.join(process.cwd(), "_data", 'minimal-stops.json');

  if (!fs.existsSync(stopsDir)) {
    fs.mkdirSync(stopsDir, { recursive: true });
  }

  if (!fs.existsSync(linesDir)) {
    fs.mkdirSync(linesDir, { recursive: true });
  }

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
    topoData.pointArret.forEach(stop => {
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
        stopName: stop.nomCommercial,
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
      fs.writeFileSync(filePath, JSON.stringify(enrichedStop, null, 2), 'utf-8');
      console.log(`Wrote enriched stop data to ${filePath}`);
    });
  } else {
    console.warn("No pointArret data found in topography.");
  }
  fs.writeFileSync(minimalStopsFile, JSON.stringify(minimalStops, null, 2), 'utf-8');

  // Generate JSON files for lines
  if (topoData.ligne) {
    topoData.ligne.forEach(line => {
      const filePath = path.join(linesDir, `${line.idLigne}.json`);
      fs.writeFileSync(filePath, JSON.stringify(line, null, 2), 'utf-8');
      console.log(`Wrote line data to ${filePath}`);
    });
  } else {
    console.warn("No ligne data found in topography.");
  }
}

main().catch(err => {
  console.error('Error generating JSON files:', err);
  process.exit(1);
});

