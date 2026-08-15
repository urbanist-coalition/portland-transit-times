// This is a utility script to make sure fixCapitalization handles all of the headsigns properly.
// There is a hack in fixCapitalization where specific acronyms are identified and left in all caps.

import { fixCapitalization } from "@/lib/name-normalization";
import { GPMETRO } from "@/lib/constants";
import { GTFSStatic } from "@/lib/gtfs/static";

async function main() {
  const gtfs = new GTFSStatic(GPMETRO);
  await gtfs.load();

  const trips = await gtfs.getTrips();
  const headsigns = new Set<string>();
  // Trips with no headsign at all, grouped by route and direction. GPMETRO
  // leaves these blank for whole directions of some routes, so surface them
  // here rather than skipping them — loadStatic falls back to the last stop.
  const blankByRoute = new Map<string, number>();
  for (const trip of trips) {
    if (trip.trip_headsign) {
      headsigns.add(trip.trip_headsign);
    } else {
      const key = `${trip.route_id} (direction ${trip.direction_id})`;
      blankByRoute.set(key, (blankByRoute.get(key) || 0) + 1);
    }
  }

  console.table(
    Array.from(headsigns).map((raw) => ({ raw, clean: fixCapitalization(raw) }))
  );

  if (blankByRoute.size > 0) {
    console.warn("\nTrips with a blank trip_headsign:");
    console.table(
      Array.from(blankByRoute).map(([route, trips]) => ({ route, trips }))
    );
  }
}

main();
