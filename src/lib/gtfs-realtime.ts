import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getRedisClient } from "./redis";

export async function loadVehiclePositions() {
  const client = getRedisClient();

  const response = await fetch(
    "https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/VehiclePosition.pb"
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  const vehicles = await Promise.all(
    feed.entity.map(async ({ vehicle }) => ({
      vehicleId: vehicle?.vehicle?.id,
      lineName: await client.get(`trip_route:${vehicle?.trip?.tripId}`),
      location: {
        lat: vehicle?.position?.latitude,
        lng: vehicle?.position?.longitude,
      },
    }))
  );

  await client.set("vehicles", JSON.stringify(vehicles));
}
