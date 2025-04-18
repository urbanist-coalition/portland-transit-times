import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import model from "@/lib/redis";
import { ServiceAlert, VehicleData, vehicleDataSchema } from "@/types";
import Ajv from "ajv";
import { GPMETRO } from "./gtfs/types";

export async function loadVehiclePositions() {
  console.log("Loading vehicle positions...");

  const response = await fetch(GPMETRO.vehicleURL);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  const validate = new Ajv().compile(vehicleDataSchema);

  const vehicles = (
    await Promise.all(
      feed.entity.map(async ({ vehicle }): Promise<VehicleData | null> => {
        const vehicleData = {
          vehicleId: vehicle?.vehicle?.id,
          lineName: await model.getTripRouteID(vehicle?.trip?.tripId || ""),
          location: {
            lat: vehicle?.position?.latitude,
            lng: vehicle?.position?.longitude,
          },
        };

        if (!validate(vehicleData)) {
          console.warn("Invalid vehicle data:", validate.errors);
          return null;
        }

        return vehicleData;
      })
    )
  ).filter((vehicle): vehicle is VehicleData => vehicle !== null);

  await model.setVehicles(vehicles);
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

  const response = await fetch(GPMETRO.alertsURL);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  const alerts = feed.entity
    .map(mapAlertEntityToServiceAlert)
    .filter((alert): alert is ServiceAlert => alert !== null);
  await model.setServiceAlerts(alerts);
}

async function main() {
  console.log("Loading service alerts...");

  const response = await fetch(GPMETRO.tripUpdatesURL);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  console.log(feed.entity.map((x) => x.tripUpdate?.trip.start)); // Example usage of the delay property
}

main();
