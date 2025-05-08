import { CronJob } from "cron";

import { loadStatic } from "@/lib/loaders/static";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { GPMETRO } from "@/lib/constants";
import { RedisModel } from "@/lib/model";

async function main() {
  const model = new RedisModel();
  async function loadStaticGPMetro() {
    await loadStatic(GPMETRO, model);
  }

  // This must run at least once on startup
  await loadStaticGPMetro();

  const gtfsRealtimeLoader = new GTFSRealtimeLoader(GPMETRO, model);

  // This will run every day at midnight
  CronJob.from({
    cronTime: "0 0 0 * * *",
    onTick: loadStaticGPMetro,
    start: true,
    // Run when the job is started, useful for shipping changes to the loader
    runOnInit: true,
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
}

main();
