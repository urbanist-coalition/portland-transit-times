/**
 * @file The worker: realtime in, files out.
 *
 * It owns nothing static. The release builder decides what the site is — the
 * pages, the map, the schedule — and this keeps that release current: it polls
 * the agency's realtime feeds, joins them onto the release's schedule, and
 * writes the arrivals every page reads.
 *
 * When a build makes a new release live, the symlink under it changes. That is
 * the only signal needed: reload the schedule, re-read the pages, carry on.
 */

import { readlink } from "node:fs/promises";
import { join } from "node:path";

import { CronJob } from "cron";

import { GPMETRO } from "@/lib/constants";
import { TransitStore } from "@/lib/feed/store";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { Releases } from "@/lib/release";
import { SnapshotWriter } from "@/lib/snapshots";

async function main() {
  const releases = new Releases(
    process.env.RELEASES_DIR ?? "releases",
    process.env.DATA_DIR ?? "_data"
  );
  const current = releases.currentLink;

  const store = new TransitStore(GPMETRO.timeZone);
  const snapshots = new SnapshotWriter(
    store,
    join(current, "data"),
    join(current, "site")
  );

  /** The release the worker is currently serving, so a flip can be noticed. */
  let serving: string | null = null;

  async function followCurrentRelease() {
    let target: string;
    try {
      target = await readlink(current);
    } catch {
      console.warn(
        `[worker] no release yet at ${current} — waiting for a build`
      );
      return;
    }
    if (target === serving) return;

    console.log(`[worker] release ${target}`);
    await store.loadStatic(join(current, "static.json"));
    await snapshots.loadShells();
    serving = target;
  }

  await followCurrentRelease();

  const realtime = new GTFSRealtimeLoader(GPMETRO, store);

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

  // A build can land at any moment; this is how the worker finds out.
  CronJob.from({
    cronTime: "*/5 * * * * *",
    onTick: followCurrentRelease,
    start: true,
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
