/**
 * @file Differential test: the current loader against the new one.
 *
 * A data-layer rewrite is only safe if you can say exactly how its output
 * differs from what it replaces. This runs both readings over the same feed
 * bytes, with the same clock, and reports every difference — so the ones that
 * are deliberate can be named and the rest investigated.
 *
 * Neither Redis nor the network is involved. `Model` is an interface, so the
 * old loader can be run against a recorder that keeps what it would have
 * written, and both sides read a feed already on disk.
 *
 * Usage:
 *   npx tsx scripts/compare-loaders.ts [path/to/gtfs.zip]
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";

import unzipper from "unzipper";

import { GPMETRO } from "@/lib/constants";
import { GTFSStatic } from "@/lib/gtfs/static";
import { loadStatic } from "@/lib/loaders/static";
import { Model } from "@/lib/model";
import { normalizeFeed } from "@/lib/feed/normalize";
import { DEFAULT_WINDOW, expandInstances } from "@/lib/feed/expand";
import { Route, Stop, StopTimeInstance, Trip } from "@/types";

/** Keeps whatever the loader writes, instead of writing it anywhere. */
class RecordingModel implements Partial<Model> {
  stops: Stop[] = [];
  trips: Trip[] = [];
  routes: Route[] = [];
  instances: StopTimeInstance[] = [];

  async setStops(stops: Stop[]) {
    this.stops = stops;
  }
  async setTrips(trips: Trip[]) {
    this.trips = trips;
  }
  async setRoutes(routes: Route[]) {
    this.routes = routes;
  }
  async setStopTimeInstances(instances: StopTimeInstance[]) {
    this.instances = instances;
  }
  async cleanupStopTimeInstances() {}
  async setStopsLastUpdatedAt() {}
}

const key = (instance: StopTimeInstance) =>
  `${instance.serviceDate}:${instance.tripId}:${instance.stopId}`;

function compareSets<T>(
  label: string,
  before: Map<string, T>,
  after: Map<string, T>,
  describe: (value: T) => string
) {
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...before.keys()].filter(
    (k) => after.has(k) && describe(before.get(k)!) !== describe(after.get(k)!)
  );

  console.log(`\n${label}`);
  console.log(`  before ${before.size}   after ${after.size}`);
  console.log(
    `  added ${added.length}   removed ${removed.length}   changed ${changed.length}`
  );
  for (const k of changed.slice(0, 5)) {
    console.log(`    ${k}`);
    console.log(`      was  ${describe(before.get(k)!)}`);
    console.log(`      now  ${describe(after.get(k)!)}`);
  }
  return { added, removed, changed };
}

async function extract(zipPath: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "feed-"));
  await new Promise((resolve, reject) =>
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: directory }))
      .on("close", resolve)
      .on("error", reject)
  );
  return directory;
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) throw new Error("give me a path to a gtfs.zip");

  const directory = await extract(zipPath);
  // Both sides read this, so nothing can differ because of what was downloaded.
  const feedDirectory = GTFSStatic.fromDirectory(directory, "comparison");

  // One clock for both, so the windows line up.
  const now = Date.now();

  console.log("running the current loader...");
  const recorder = new RecordingModel();
  await loadStatic({ ...GPMETRO }, recorder as unknown as Model, feedDirectory);

  console.log("running the new one...");
  const feed = await normalizeFeed(feedDirectory);
  const expanded = expandInstances(feed, now, GPMETRO.timeZone, DEFAULT_WINDOW);
  const newInstances = [...expanded.values()].flat();

  compareSets(
    "routes",
    new Map(recorder.routes.map((r) => [r.routeId, r])),
    new Map(feed.routes.map((r) => [r.routeId, r])),
    (r) => `${r.routeShortName} ${r.routeColor}/${r.routeTextColor}`
  );
  compareSets(
    "trips",
    new Map(recorder.trips.map((t) => [t.tripId, t])),
    new Map(feed.trips.map((t) => [t.tripId, t])),
    (t) => `${t.routeId} ${t.serviceId} "${t.tripHeadsign}"`
  );
  compareSets(
    "stops",
    new Map(recorder.stops.map((s) => [s.stopId, s])),
    new Map(feed.stops.map((s) => [s.stopId, s])),
    (s) =>
      `"${s.stopName}" ${s.routes
        .map((r) => r.routeShortName)
        .sort()
        .join(",")}`
  );
  const instanceDiff = compareSets(
    "stop time instances",
    new Map(recorder.instances.map((i) => [key(i), i])),
    new Map(newInstances.map((i) => [key(i), i])),
    (i) => new Date(i.scheduledTime).toISOString()
  );

  // Where the two windows disagree, which is the likeliest source of a large
  // difference: the old loader's bound was `differenceInDays(date, now) <= 3`,
  // which truncates and so reaches further on some days than others.
  const perDate = (instances: StopTimeInstance[]) => {
    const counts = new Map<string, number>();
    for (const instance of instances) {
      counts.set(
        instance.serviceDate,
        (counts.get(instance.serviceDate) || 0) + 1
      );
    }
    return counts;
  };
  const before = perDate(recorder.instances);
  const after = perDate(newInstances);
  console.log("\nservice dates");
  for (const date of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    console.log(
      `  ${date}  before ${String(before.get(date) ?? 0).padStart(6)}   after ${String(after.get(date) ?? 0).padStart(6)}`
    );
  }

  // The added instances should be exactly the layovers the old filter dropped.
  const stopsById = new Map(feed.stops.map((s) => [s.stopId, s]));
  const addedByStop = new Map<string, number>();
  for (const k of instanceDiff.added) {
    const stopId = k.split(":").slice(2).join(":");
    addedByStop.set(stopId, (addedByStop.get(stopId) || 0) + 1);
  }
  if (addedByStop.size) {
    console.log("\nwhere the new departures are");
    for (const [stopId, count] of [...addedByStop].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${stopsById.get(stopId)?.stopName ?? stopId}: ${count}`);
    }
  }

  await rm(directory, { recursive: true, force: true });
}

main();
