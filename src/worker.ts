/**
 * @file The worker: feeds in, files out.
 *
 * Three things happen here, on three clocks.
 *
 *   the feed        downloaded when it changes, normalised into the artifact a
 *                   release carries, and the site rebuilt from it
 *   realtime        vehicle positions and predictions, every second
 *   the snapshots   what the pages read, written whenever any of it moves
 *
 * There is no database. The schedule is a file on disk and everything else
 * lives in this process — see lib/feed/store.ts for why that is enough.
 */

import { CronJob } from "cron";

import { GPMETRO } from "@/lib/constants";
import { writeStaticFeed } from "@/lib/feed/artifact";
import { normalizeFeed } from "@/lib/feed/normalize";
import { TransitStore } from "@/lib/feed/store";
import { GTFSStatic } from "@/lib/gtfs/static";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { SnapshotWriter } from "@/lib/snapshots";

async function main() {
  const dataDir = process.env.DATA_DIR ?? "_data";
  const siteDir = process.env.SITE_DIR ?? "_site";
  const artifactPath = process.env.STATIC_FEED ?? `${dataDir}/static.json`;

  const store = new TransitStore(GPMETRO.timeZone);
  const snapshots = new SnapshotWriter(store, dataDir, siteDir);

  /**
   * Downloads the feed if it has changed, writes the artifact, and rebuilds
   * everything derived from it.
   *
   * The artifact is written and then read back rather than kept: the file is
   * what the site build and the next worker start will use, so loading it here
   * too means this process is running on exactly what it published.
   */
  async function loadFeed() {
    const gtfs = await GTFSStatic.create(GPMETRO, store.feedHash);
    try {
      if (!gtfs.changed && store.loaded) {
        console.log("[feed] unchanged");
        return;
      }
      if (!(await gtfs.hasRequiredData())) {
        console.warn("[feed] missing required files, keeping what we have");
        return;
      }

      const feed = await normalizeFeed(gtfs);
      await writeStaticFeed(artifactPath, feed);
      await store.loadStatic(artifactPath);

      // Stop names, numbers and route pills live in the HTML, so a new feed
      // means the pages themselves are out of date, not just their data.
      await snapshots.buildSite();
      await snapshots.writeStopNames();
      if (process.env.STATIC_BUILD_HEARTBEAT_URL) {
        await fetch(process.env.STATIC_BUILD_HEARTBEAT_URL);
      }
    } finally {
      await gtfs.cleanup();
    }
  }

  await loadFeed();

  const realtime = new GTFSRealtimeLoader(GPMETRO, store);

  // The feed is small and rarely changes; most of these are one conditional
  // request that comes back "not modified".
  CronJob.from({
    cronTime: "0 */10 * * * *",
    onTick: loadFeed,
    start: true,
    waitForCompletion: true,
  });

  CronJob.from({
    cronTime: "* * * * * *",
    onTick: () => realtime.loadVehiclePositions(),
    start: true,
    waitForCompletion: true,
  });

  CronJob.from({
    cronTime: "* * * * * *",
    onTick: () => realtime.loadTripUpdates(),
    start: true,
    waitForCompletion: true,
  });

  CronJob.from({
    cronTime: "0 0 * * * *",
    onTick: () => realtime.loadServiceAlerts(),
    start: true,
    // Useful when shipping changes to the loader.
    runOnInit: true,
    waitForCompletion: true,
  });

  // Predictions for departures that have left the window are dead weight.
  CronJob.from({
    cronTime: "0 0 4 * * *",
    onTick: () => store.prunePredictions(),
    start: true,
  });

  // Everything above puts data in memory; this puts it on disk, where the site
  // is served from. It decides for itself what has changed, so it is safe to
  // run every second regardless of what the loaders did.
  CronJob.from({
    cronTime: "* * * * * *",
    onTick: () => snapshots.tick(),
    start: true,
    runOnInit: true,
    waitForCompletion: true,
  });
}

main();
