// This is a utility script to make sure fixCapitalization handles all of the headsigns properly.
// There is a hack in fixCapitalization where specific acronyms are identified and left in all caps.

import { GPMETRO } from "@/lib/constants";
import { GTFSStatic } from "@/lib/gtfs/static";

async function main() {
  const gtfs = new GTFSStatic(GPMETRO);
  await gtfs.load();

  const stops = await gtfs.getStops();
  const stopNames = new Set<string>();
  const duplicateStopNames = new Set<string>();
  for (const stop of stops) {
    if (stopNames.has(stop.stop_name)) {
      duplicateStopNames.add(stop.stop_name);
    }
    stopNames.add(stop.stop_name);
  }

  for (const stop of duplicateStopNames) {
    console.log(stop);
  }
}

main();
