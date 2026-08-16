// Prints the warnings normalising the feed produces — ambiguous stop names
// that the disambiguation rules could not tell apart, trips with no headsign
// and no last stop to borrow one from.
//
// This is the tool for maintaining the hardcoded overrides in
// lib/loaders/stop-name-deduplication.ts: run it, read what it complains
// about, decide what those stops should be called.
//
//   npx tsx src/scripts/static-loader.ts

import { GPMETRO } from "@/lib/constants";
import { normalizeFeed } from "@/lib/feed/normalize";
import { GTFSStatic } from "@/lib/gtfs/static";

async function main() {
  await using gtfs = await GTFSStatic.create(GPMETRO);
  const feed = await normalizeFeed(gtfs);
  console.log(
    `${feed.stops.length} stops, ${feed.trips.length} trips, ` +
      `${feed.calls.length} scheduled calls`
  );
}

main().catch(console.error);
