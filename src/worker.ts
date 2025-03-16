import { CronJob } from "cron";

import { loadTripIdToRouteID } from "@/lib/gtfs";
import { loadServiceAlerts, loadVehiclePositions } from "@/lib/gtfs-realtime";

async function main() {
  // This must run at least once on startup
  await loadTripIdToRouteID();
  // This will run every day at midnight
  new CronJob("0 0 0 * * *", loadTripIdToRouteID).start();

  new CronJob("* * * * * *", loadVehiclePositions).start();

  // This will run every hour
  new CronJob("0 0 * * * *", loadServiceAlerts).start();
}

main();
