import { stopPredictions, topography } from "@/lib/conduent";
import { readJSON, writeJSON } from "@/lib/file-utils";
import { toProperCase } from "@/lib/utils";

/** A record of directions by stopCode and lineName, designed to be JSON serialized. 
 *
 * For example:
 * {
 *  "1234": {
 *    "Line 1": {
 *      "Destination A": true,
 *      "Destination B": true
 *    }
 *  }
 * }
 */
type StopDestinations = Record<string, Record<string, boolean>>;
type DestinationsByStopCode = Record<string, StopDestinations>;

async function asyncWait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (retries >= maxRetries) {
        throw e;
      }
      retries++;
      await asyncWait(retries * 1000);
    }
  }
}

const stopCodeOverrides: Record<string, string> = {
  // PTC
  "422": "PTC (Outbound)",
  "820": "PTC (Inbound)",
  // Congress & Weymouth
  "183": "Congress & Weymouth (Outbound)",
  "184": "Congress & Weymouth (Inbound)",
  // Congress & Park
  "167": "Congress & Park (Outbound)",
  "168": "Congress & Park (Inbound)",
  // Congress & Forest
  //   This one is particularly confusing because 251 is Forest & Congress, around the corner
  "1054": "Congress & Forest (Inbound)",
  "132": "Congress & Forest (Outbound)",
}

function flatDestinations(stopDestinations: StopDestinations): string[] {
  return Object.keys(stopDestinations).flatMap(line => Object.keys(stopDestinations[line]));
}

function nameOverrides(stopName: string, stopCodes: string[], destinationsByStopCode: DestinationsByStopCode): Record<string, string> {
  // Some stops have the same name but serve buses going in different directions on different sides of the street
  //   We want to distinguish these by the destination, however some of these stops serve multiple destinations
  //   in which case we use Inbound/Outbound. We want to sometimes make the Inbound/Outbound distinction based on
  //   just one of the stops in the set so we need to take in all of the stop codes and return a code/name mapping.
  //   This mapping will be used to override stop names.

  if (stopCodes.length === 1) return {}; // No need to remap anything here


  // Stops that were not caught by the rules are manually disambiguated with stopCodeOverrides.
  const nOverrides = stopCodes.filter(stopCode => stopCodeOverrides[stopCode]).length;
  // If we have an override for every stop except one (one stop can keep it's original name), use them
  if (nOverrides >= stopCodes.length - 1) return stopCodes.reduce((acc, stopCode) => ({ ...acc, [stopCode]: stopCodeOverrides[stopCode] }), {});


  // The rules below can only handle pairs
  if (stopCodes.length > 2) throw new Error(`Stop name '${stopName}' has more than two stop codes [${stopCodes.join(", ")}]`);

  const [stopCodeA, stopCodeB] = stopCodes;
  const aDestinations = flatDestinations(destinationsByStopCode[stopCodeA]);
  const bDestinations = flatDestinations(destinationsByStopCode[stopCodeB]);

  // PULSE is the center of the universe, a lot of buses branch out from PULSE, if either stop serves a line with a destination of PULSE
  //   that is Inbound and it's duplicate must be Outbound. We can't always use destinations because some require passing through
  //   the center of the city to get to so whether or not it is inbound or outbound will be effected by where the stop is. Because
  //   PULSE is the center we can safely use it.
  if (aDestinations.includes('PULSE')) {
    return {
      [stopCodeA]: `${toProperCase(stopName)} (Inbound)`,
      [stopCodeB]: `${toProperCase(stopName)} (Outbound)`,
    }
  }

  if (bDestinations.includes('PULSE')) {
    return {
      [stopCodeA]: `${toProperCase(stopName)} (Outbound)`,
      [stopCodeB]: `${toProperCase(stopName)} (Inbound)`,
    }
  }

  // If either stop only has one direction you can differentiate the names by adding the direction
  //   to the stop name. Even if the other stop serves multiple destinations it still disambiguates them.
  if (aDestinations.length === 1 || bDestinations.length === 1) return {
    [stopCodeA]: toProperCase(aDestinations.length === 1 ? `${stopName} ↪ ${aDestinations[0]}` : stopName),
    [stopCodeB]: toProperCase(bDestinations.length === 1 ? `${stopName} ↪ ${bDestinations[0]}` : stopName),
  };

  // If we get here that means we need a stopCodeOverrides entry, print the data to help with that.
  console.log("Ambiguous stop name:", stopName)
  for (const destination of aDestinations) {
    console.log("  A", stopCodeA, destination);
  }
  for (const destination of bDestinations) {
    console.log("  B", stopCodeB, destination);
  }

  throw new Error(`Ambiguous stop name: ${stopName}`);
}

async function main(refreshPredictions = false) {
  const topo = await topography();

  const linesById: Record<string, string> = {};
  for (const { idLigne, nomCommercial } of topo.topo[0].ligne) {
    linesById[idLigne] = nomCommercial;
  }

  // Persist this, we can only get predictions when there are buses around
  const lineDirectionsByStopCode: DestinationsByStopCode = await readJSON("stop-predictions", {}, true);
  if (refreshPredictions) {
    for (const { idPointArret, stopCode } of topo.topo[0].pointArret) {
      const prediction = await tryWithRetry(() => stopPredictions(idPointArret));

      if (!lineDirectionsByStopCode[stopCode]) lineDirectionsByStopCode[stopCode] = {};
      for (const { idLigne, destination } of prediction.listeHoraires) {

        const lineName = linesById[idLigne];
        if (!lineName) continue;

        if (!lineDirectionsByStopCode[stopCode][lineName]) lineDirectionsByStopCode[stopCode][lineName] = {};
        for (const { libelle } of destination) {
          lineDirectionsByStopCode[stopCode][lineName][libelle] = true
        }
      }
    }
    writeJSON("stop-predictions", lineDirectionsByStopCode, true);
  }

  const stopsByName: Record<string, string[]> = {};
  for (const { stopCode, nomCommercial } of topo.topo[0].pointArret) {
    if (!stopsByName[nomCommercial]) stopsByName[nomCommercial] = [];
    stopsByName[nomCommercial].push(stopCode);
  }

  const stopNameOverrides: Record<string, string> = {};
  for (const [stopName, stopCodes] of Object.entries(stopsByName)) {
    Object.assign(stopNameOverrides, nameOverrides(stopName, stopCodes, lineDirectionsByStopCode));
  }

  await writeJSON("stop-name-overrides", stopNameOverrides);
}

main(process.argv[2] === "--refresh").catch(console.error);
