import { CronJob } from "cron";

import { loadStatic } from "@/lib/loaders/static";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { GPMETRO } from "@/lib/constants";
import { RedisModel } from "@/lib/model";

// Triggers Next.js to rebuild static pages with fresh GTFS data
// See: src/app/api/revalidate/route.ts
async function revalidateStaticPages() {
  const baseUrl = process.env.REVALIDATE_URL || "http://localhost:3000";
  const token = process.env.REVALIDATE_TOKEN;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${baseUrl}/api/revalidate`, {
      method: "POST",
      headers,
    });
    if (response.ok) {
      console.log("Successfully triggered revalidation");
      // Warm the cache by fetching the page after revalidation
      await fetch(`${baseUrl}/by-location`);
      console.log("Cache warmed for /by-location");
    } else {
      console.error("Failed to trigger revalidation:", response.status);
    }
  } catch (error) {
    console.error("Error triggering revalidation:", error);
  }
}

async function main() {
  const model = new RedisModel();
  async function loadStaticGPMetro() {
    const changed = await loadStatic(GPMETRO, model);
    if (changed) {
      await revalidateStaticPages();
    }
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
}

main();
