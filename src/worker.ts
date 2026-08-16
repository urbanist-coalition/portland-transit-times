import { CronJob } from "cron";

import { loadStatic } from "@/lib/loaders/static";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { GPMETRO } from "@/lib/constants";
import { RedisModel } from "@/lib/model";
import { SnapshotWriter } from "@/lib/snapshots";

async function main() {
  const model = new RedisModel();

  // The site is files: nginx serves them, and this is the only thing that
  // writes them. `_site` is the built HTML, `_data` the JSON the pages poll.
  const snapshots = new SnapshotWriter(
    model,
    process.env.DATA_DIR ?? "_data",
    process.env.SITE_DIR ?? "_site"
  );

  async function loadStaticGPMetro() {
    await loadStatic(GPMETRO, model);
    // Stop names, numbers and route pills live in the HTML, so a new feed
    // means the pages themselves are out of date, not just their data.
    await snapshots.buildSite();
    if (process.env.STATIC_BUILD_HEARTBEAT_URL) {
      await fetch(process.env.STATIC_BUILD_HEARTBEAT_URL);
    }
  }

  // Load the static data once at startup
  await loadStaticGPMetro();

  const gtfsRealtimeLoader = new GTFSRealtimeLoader(GPMETRO, model);

  // This will run every 10 minutes, it is cached so it won't redownload if not changed
  CronJob.from({
    cronTime: "0 */10 * * * *",
    onTick: loadStaticGPMetro,
    start: true,
    waitForCompletion: true,
  });

  // This will run every second
  CronJob.from({
    cronTime: "* * * * * *",
    onTick: gtfsRealtimeLoader.loadVehiclePositions.bind(gtfsRealtimeLoader),
    start: true,
    waitForCompletion: true,
  });

  CronJob.from({
    cronTime: "* * * * * *",
    onTick: gtfsRealtimeLoader.loadTripUpdates.bind(gtfsRealtimeLoader),
    start: true,
    waitForCompletion: true,
  });

  // This will run every hour
  CronJob.from({
    cronTime: "0 0 * * * *",
    onTick: gtfsRealtimeLoader.loadServiceAlerts.bind(gtfsRealtimeLoader),
    start: true,
    // Run when the job is started, useful for shipping changes to the loader
    runOnInit: true,
    waitForCompletion: true,
  });

  // Everything above puts data in Redis; this puts it on disk, where the site
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
