import { fixCapitalization } from "@/lib/capitalization";
import { indexBy } from "@/lib/utils";
import { Stop } from "@/types";

// Hardcoded overrides for stop names that are ambiguous and can't be disambiguated by the destinations.
//   Use src/scripts/static-loader.ts to surface warnings and add to this list.
const stopIdOverrides: Record<string, string> = {
  // PTC
  "0:422": "PTC (Outbound)",
  "0:820": "PTC (Inbound)",
  // Congress & Weymouth
  "0:183": "Congress & Weymouth (Outbound)",
  "0:184": "Congress & Weymouth (Inbound)",
  // Congress & Park
  "0:167": "Congress & Park (Inbound)",
  "0:168": "Congress & Park (Outbound)",
  // Congress & Forest
  //   This one is particularly confusing because 251 is Forest & Congress, around the corner
  "0:1054": "Congress & Forest (Inbound)",
  "0:132": "Congress & Forest (Outbound)",
  // Preble St ext. + Marginal Way
  "0:423": "Preble St ext. + Marginal Way (Inbound)",
  "0:693": "Preble St ext. + Marginal Way (Outbound)",
  // Stevens Ave + Brighton Ave
  //   Note: one arm of this has OUTBOUND in it's destination names so we may be able to identify this one automatically
  "0:502": "Stevens Ave + Brighton Ave (Outbound)",
  "0:503": "Stevens Ave + Brighton Ave (Inbound)",
};

/**
 * This function is used to disambiguate stop names that are the same but serve different routes.
 * It takes in a stop name, a list of stop IDs, and a map of destinations by stop ID.
 * It returns a mapping of stop IDs to their new names.
 *
 * It tries its best to use the destinations to disambiguate the stop names, but if it can't,
 * it will print a warning and return an empty object, leaving the stop names unchanged.
 */
function ruleBasedOverrides(
  stopName: string,
  stopIds: [string, string],
  destinationsByStopId: Record<string, string[]>
): Record<string, string> {
  const [stopIdA, stopIdB] = stopIds;

  const aDestinations = destinationsByStopId[stopIdA];
  if (!aDestinations) {
    console.warn(`Missing destinations for stop ${stopIdA} - ${stopName}`);
    return {};
  }

  const bDestinations = destinationsByStopId[stopIdB];
  if (!bDestinations) {
    console.warn(`Missing destinations for stop ${stopIdB} - ${stopName}`);
    return {};
  }

  // PULSE is the center of the universe, a lot of buses branch out from PULSE, if either stop serves a route with a destination of PULSE
  //   that is Inbound and it's duplicate must be Outbound. We can't always use destinations because some require passing through
  //   the center of the city to get to so whether or not it is inbound or outbound will be effected by where the stop is. Because
  //   PULSE is the center we can safely use it.
  if (aDestinations.includes("Pulse")) {
    return {
      [stopIdA]: `${stopName} (Inbound)`,
      [stopIdB]: `${stopName} (Outbound)`,
    };
  }

  if (bDestinations.includes("Pulse")) {
    return {
      [stopIdA]: `${stopName} (Outbound)`,
      [stopIdB]: `${stopName} (Inbound)`,
    };
  }

  // If either stop only has one direction you can differentiate the names by adding the direction
  //   to the stop name. Even if the other stop serves multiple destinations it still disambiguates them.
  if (aDestinations.length === 1 || bDestinations.length === 1)
    return {
      [stopIdA]:
        aDestinations.length === 1
          ? `${stopName} ⇨ ${aDestinations[0]}`
          : stopName,
      [stopIdB]:
        bDestinations.length === 1
          ? `${stopName} ⇨ ${bDestinations[0]}`
          : stopName,
    };

  // If we get here that means we need a stopIdOverrides entry, print the data to help with that.
  console.warn("Ambiguous stop name:", stopName);
  for (const destination of aDestinations) {
    console.warn("  A", stopIdA, destination);
  }
  for (const destination of bDestinations) {
    console.warn("  B", stopIdB, destination);
  }
  return {};
}

function nameOverrides(
  stopName: string,
  stopIds: string[],
  destinationsByStopId: Record<string, string[]>
): Record<string, string> {
  // Some stops have the same name but serve buses going in different directions on different sides of the street
  //   We want to distinguish these by the destination, however some of these stops serve multiple destinations
  //   in which case we use Inbound/Outbound. We want to sometimes make the Inbound/Outbound distinction based on
  //   just one of the stops in the set so we need to take in all of the stop IDs and return a ID/name mapping.
  //   This mapping will be used to override stop names.

  if (stopIds.length === 1) return {}; // No need to remap anything here

  // Stops that were not caught by the rules are manually disambiguated with stopIdOverrides.
  const nOverrides = stopIds.filter((stopId) => stopIdOverrides[stopId]).length;
  // If we have an override for every stop except one (one stop can keep it's original name), use them
  if (nOverrides >= stopIds.length - 1)
    return stopIds.reduce(
      (acc, stopId) => ({ ...acc, [stopId]: stopIdOverrides[stopId] }),
      {}
    );

  // The rules below can only handle pairs
  if (stopIds.length > 2)
    throw new Error(
      `Stop name '${stopName}' has more than two stop IDs [${stopIds.join(", ")}]`
    );
  const overrides = ruleBasedOverrides(
    stopName,
    stopIds as [string, string],
    destinationsByStopId
  );

  // Fix capitalization of what comes out of the rules
  //   Overrides will not have their cases fixed downstream so we can use overrides to
  //   fix capitalization issues. Rule based overrides don't fix capitalization issues
  //   so we need to do it here.
  for (const [stopId, name] of Object.entries(overrides)) {
    overrides[stopId] = fixCapitalization(name);
  }

  return overrides;
}

export function generateStopNameOverrides(
  stops: Stop[],
  destinationsByStopId: Record<string, string[]>
): Record<string, string> {
  const stopsByName = indexBy(stops, "stopName");

  const stopNameOverrides: Record<string, string> = {};
  for (const [stopName, stopIds] of stopsByName.entries()) {
    Object.assign(
      stopNameOverrides,
      nameOverrides(
        stopName,
        stopIds.map(({ stopId }) => stopId),
        destinationsByStopId
      )
    );
  }

  return stopNameOverrides;
}
