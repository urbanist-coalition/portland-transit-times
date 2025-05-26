import {
  normalizeInOutBound,
  fixCapitalization,
} from "@/lib/name-normalization";
import { GPMETRO } from "@/lib/constants";
import { GTFSStatic } from "@/lib/gtfs/static";

async function main() {
  const gtfs = new GTFSStatic(GPMETRO);
  await gtfs.load();

  const stops = await gtfs.getStops();
  for (const stop of stops) {
    const before = stop.stop_name;
    const afterBound = normalizeInOutBound(stop.stop_name);
    const after = fixCapitalization(afterBound);
    if (before !== afterBound) {
      console.log(`${before}, ${afterBound}, ${after}`);
    }
  }
}

main();
