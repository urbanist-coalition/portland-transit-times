import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { GPMETRO } from "@/lib/constants";
import { Prisma, ServiceAlert } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

  const vehiclesData: Prisma.VehicleCreateManyInput[] = [];
  for (const entity of feed.entity) {
    if (!entity.vehicle) continue;

    const vehicleId = entity.vehicle?.vehicle?.id;
    const tripId = entity.vehicle?.trip?.tripId;
    const lat = entity.vehicle?.position?.latitude;
    const lng = entity.vehicle?.position?.longitude;

    if (!vehicleId || !tripId || !lat || !lng) {
      console.warn("Invalid vehicle data:", entity);
      continue;
    }

    const vehicleData = {
      vehicleId,
      tripId,
      location: { lat, lng },
    };

    vehiclesData.push(vehicleData);
  }

  await prisma.$transaction(async (tx) => {
    await tx.vehicle.deleteMany();
    await tx.vehicle.createMany({
      data: vehiclesData,
    });
  });
}

function mapAlertEntityToServiceAlert(
  entity: GtfsRealtimeBindings.transit_realtime.IFeedEntity
) {
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
    header: headerEn.text,
    description: descEn.text,
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

  await prisma.$transaction(async (tx) => {
    await tx.serviceAlert.deleteMany();
    await tx.serviceAlert.createMany({
      data: alerts,
    });
  });
}

export async function loadTripUpdates() {
  console.log("Loading trip updates...");

  const response = await fetch(GPMETRO.tripUpdatesURL);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  for (const entity of feed.entity) {
    console.log("Loading trip updates...");
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;

    const tripId = tripUpdate.trip?.tripId;
    const startDate = tripUpdate.trip?.startDate;
    if (!tripId || !startDate) continue;

    const stopTimeUpdates = tripUpdate.stopTimeUpdate || [];

    await Promise.all(
      stopTimeUpdates.map(async (stopTimeUpdate) => {
        const arrival = stopTimeUpdate.arrival?.time;
        const delay = stopTimeUpdate.arrival?.delay;
        const stopId = stopTimeUpdate.stopId;

        if (!arrival || !delay || !stopId) {
          console.warn("Invalid stop time update data:", stopTimeUpdate);
          return;
        }

        const arrivalNumber =
          typeof arrival === "number" ? arrival : arrival.toNumber();

        await prisma.stopTimeInstance.update({
          where: {
            serviceDate_tripId_stopId: {
              serviceDate: startDate,
              tripId,
              stopId,
            },
          },
          data: {
            estimatedArrival: new Date((arrivalNumber + delay) * 1000),
          },
        });
      })
    );
  }
}
