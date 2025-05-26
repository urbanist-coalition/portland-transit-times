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
  for (const trip of trips) {
    if (trip.trip_headsign) {
      headsigns.add(trip.trip_headsign);
    }
  }

  console.table(
    Array.from(headsigns).map((raw) => ({ raw, clean: fixCapitalization(raw) }))
  );
}

main();
