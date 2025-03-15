import { loadTripIdToRouteID } from "./lib/gtfs";
import { loadVehiclePositions } from "./lib/gtfs-realtime";

async function main() {
  await loadTripIdToRouteID();

  while (true) {
    await loadVehiclePositions();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main();
