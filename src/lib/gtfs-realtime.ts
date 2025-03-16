import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getRedisClient } from "@/lib/redis";
import { ServiceAlert } from "@/types";

export async function loadVehiclePositions() {
  console.log("Loading vehicle positions...");
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

function mapAlertEntityToServiceAlert(
  entity: GtfsRealtimeBindings.transit_realtime.IFeedEntity
): ServiceAlert | null {
  const alert = entity.alert;
  if (!alert) return null;

  const headerTranslations = alert.headerText?.translation;
  const descriptionTranslations = alert.descriptionText?.translation;
  if (!headerTranslations || !descriptionTranslations) return null;

  const headerEn = headerTranslations.find((t) => t.language === "en");
  const descEn = descriptionTranslations.find((t) => t.language === "en");
  if (!headerEn || !descEn) return null;

  return {
    id: entity.id,
    headerText: headerEn.text,
    descriptionText: descEn.text,
  };
}

export async function loadServiceAlerts() {
  console.log("Loading service alerts...");
  const client = getRedisClient();

  const response = await fetch(
    "https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/Alert.pb"
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  const alerts = feed.entity.map(mapAlertEntityToServiceAlert).filter(Boolean);
  await client.set("service_alerts", JSON.stringify(alerts), "EX", 60 * 60);
}
