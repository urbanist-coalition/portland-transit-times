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

  const gtfsRealtimeLoader = new GTFSRealtimeLoader(model);

  // This will run every day at midnight
  new CronJob("0 0 0 * * *", loadStaticGPMetro).start();

  // This will run every second
  new CronJob(
    "* * * * * *",
    gtfsRealtimeLoader.loadVehiclePositions.bind(gtfsRealtimeLoader)
  ).start();
  new CronJob(
    "* * * * * *",
    gtfsRealtimeLoader.loadTripUpdates.bind(gtfsRealtimeLoader)
  ).start();

  // This will run every hour
  new CronJob(
    "0 0 * * * *",
    gtfsRealtimeLoader.loadServiceAlerts.bind(gtfsRealtimeLoader)
  ).start();
}

main();
