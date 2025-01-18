import crypto from "crypto";
import stringify from "json-stable-stringify";

import { topography } from "@/lib/conduent";
import { StopData, LineData } from "@/types";
import { readJSON, writeJSON } from "@/lib/file-utils";
import { fixCapitalization } from "@/lib/capitalization";
import { locationEquals } from "@/lib/utils";

// Replace "OB" or "O/B" and "IB" or "I/B" with "(Outbound)" and "(Inbound)" respectively.
//   In the stop names we disambiguate we use (Outbound) and (Inbound)
//   We apply this to stops labeled by the API for consistency. These are applied here
//   instead of in generate-stop-name-overrides because the overrides replace
//   stop names entirely, mostly for purposes of disambiguation.
//
//   I feel it is clearer to new users to use the full word. The only
//   reason not to would be to prevent stop names from getting too long but
//   I think the clarity outweighs the length issue.
function replaceDirectionalTerms(input: string): string {
  return input
    .replace(/\b(OB|O\/B)\b/g, "(Outbound)")
    .replace(/\b(IB|I\/B)\b/g, "(Inbound)");
}

interface StaticData {
  stops: Record<string, StopData>;
}

function computeDataHash(staticData: StaticData): string {
  const str = stringify(staticData);
  if (!str) {
    throw new Error("Failed to stringify static data.");
  }
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function generateStaticData() {
  const data = await topography();
  const topoData = data.topo[0];

  const stopNameOverrides: Record<string, string> = await readJSON(
    "src/_data/stop-name-overrides.json",
    {}
  );

  // Create a lookup map for lines by id
  const lines: Record<string, LineData> = {};
  topoData.ligne.forEach((line) => {
    const points = line.itineraire
      .map((i) => i.troncons.flatMap((t) => [t.debut, t.fin]))
      .map((segment) =>
        segment.filter((v, i) => !locationEquals(segment[i - 1], v))
      );

    lines[String(line.idLigne)] = {
      lineId: line.idLigne,
      lineName: line.nomCommercial || line.libCommercial,
      lineColor: line.couleur,
      points,
    };
  });

  const stops: Record<string, StopData> = {};

  if (topoData.pointArret.length === 0) {
    throw new Error("No pointArret data found in topography.");
  }

  await Promise.all(
    topoData.pointArret.map(async (stop) => {
      const stopName =
        stopNameOverrides[stop.stopCode] ||
        replaceDirectionalTerms(fixCapitalization(stop.nomCommercial));

      stops[stop.stopCode] = {
        stopId: stop.idPointArret,
        stopName,
        stopCode: stop.stopCode,
        location: stop.localisation,
        lineIds: stop.infoLigneSwiv.map((info) => info.idLigne),
      };
    })
  );

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
    // Must be in src so we can import
    writeJSON("src/_data/all-stops.json", stops),
    writeJSON("src/_data/all-lines.json", lines),
    // Must be public because github actions uses this to check
    //   if the live app is out of date and needs a rebuild
    writeJSON("public/_data/data-hash.json", { hash }),
  ]);
  console.log(hash);
}

main().catch((err) => {
  console.error("Error generating JSON files:", err);
  process.exit(1);
});
