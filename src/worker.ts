import { CronJob } from "cron";

import { loadStatic } from "@/lib/loaders/static";
import {
  loadServiceAlerts,
  loadVehiclePositions,
  loadTripUpdates,
} from "@/lib/gtfs-realtime";
import { GPMETRO } from "@/lib/constants";

async function main() {
  async function loadStaticGPMetro() {
    await loadStatic(GPMETRO);
  }

  // This must run at least once on startup
  await loadStaticGPMetro();

  // This will run every day at midnight
  new CronJob("0 0 0 * * *", loadStaticGPMetro).start();

  new CronJob("* * * * * *", loadVehiclePositions).start();

  new CronJob("* * * * * *", loadTripUpdates).start();

  // This will run every hour
  new CronJob("0 0 * * * *", loadServiceAlerts).start();
}

main();
