import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  Alert,
  StopTimeStatus,
  VehiclePosition,
  StopTimeUpdate,
} from "@/types";
import { Model } from "@/lib/model";
import { formatInTimeZone } from "date-fns-tz";
import { GTFSSystem } from "@/lib/gtfs/types";

export class GTFSRealtimeLoader {
  system: GTFSSystem;
  model: Model;

  constructor(system: GTFSSystem, model: Model) {
    this.system = system;
    this.model = model;
  }

  async loadVehiclePositions() {
    console.log("Loading vehicle positions...");

    const response = await fetch(this.system.vehicleURL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );
    const maybeTimestamp = feed.header?.timestamp;
    const updatedAt = maybeTimestamp
      ? this.longToNumber(maybeTimestamp) * 1000
      : Date.now();

    const vehiclesData: VehiclePosition[] = [];
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

      const trip = await this.model.getTrip(tripId);
      if (!trip) {
        console.warn("Missing trip", tripId);
        continue;
      }

      const route = await this.model.getRoute(trip.routeId);
      if (!route) {
        console.warn("Missing route", trip.routeId);
        continue;
      }

      const vehicleData = {
        vehicleId,
        position: { lat, lng },
        route,
      };

      vehiclesData.push(vehicleData);
    }
    await this.model.setVehiclePositions({
      vehicles: vehiclesData,
      updatedAt,
    });
  }

  private mapAlertEntityToServiceAlert(
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
      headerText: headerEn.text,
      descriptionText: descEn.text,
    };
  }

  async loadServiceAlerts() {
    console.log("Loading service alerts...");

    const response = await fetch(this.system.alertsURL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const alerts = feed.entity
      .map(this.mapAlertEntityToServiceAlert)
      .filter((alert): alert is Alert => alert !== null);

    await this.model.setAlerts(alerts);
  }

  private longToNumber(n: Long | number): number {
    return typeof n === "number" ? n : n.toNumber();
  }

  async loadTripUpdates() {
    console.log("Loading trip updates...");

    const response = await fetch(this.system.tripUpdatesURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    for (const entity of feed.entity) {
      // console.log("Loading trip updates...");
      const tripUpdate = entity.tripUpdate;
      if (!tripUpdate) {
        console.warn("Missing trip update data:", entity);
        continue;
      }

      const tripId = tripUpdate.trip?.tripId;
      if (!tripId) {
        console.warn("Invalid trip update data:", tripUpdate);
        continue;
      }

      // GPMETRO doesn't give us the trip's start date in the trip update
      // It is critical that the service date is the date that the trip begins because trips
      // that go past midnight belong with the service date of the date the trip starts.
      // GPMETRO does not currently have any such trips but a man can dream.
      //
      // The first update only has a departure time and the last update has only an arrival time
      const firstStopTimeUpdate = tripUpdate.stopTimeUpdate?.at(0);
      const firstDepartureTime =
        firstStopTimeUpdate?.arrival?.time ||
        firstStopTimeUpdate?.departure?.time;

      if (!firstDepartureTime) {
        console.warn("Missing first departure time:", tripUpdate);
        continue;
      }
      const startDate = formatInTimeZone(
        this.longToNumber(firstDepartureTime) * 1000,
        this.system.timeZone,
        "yyyyMMdd"
      );

      const stopTimeUpdates = tripUpdate.stopTimeUpdate || [];

      const stopTimeInstanceData: StopTimeUpdate[] = [];
      for (const stopTimeUpdate of stopTimeUpdates) {
        // For the first stop we will use the departure time because that is all we have
        // For all others we use the arrival because people are supposed to already be at the stop when the bus arrives
        const rawTime =
          stopTimeUpdate.arrival?.time || stopTimeUpdate.departure?.time;
        const stopId = stopTimeUpdate.stopId;

        if (!rawTime || !stopId) {
          console.warn("Missing time or stopId:", stopTimeUpdate);
          continue;
        }
        const time = this.longToNumber(rawTime) * 1000;

        // TODO: use the vehicle position to determine if the bus has departed
        let status = StopTimeStatus.scheduled;
        if (stopTimeUpdate.scheduleRelationship === 2) {
          status = StopTimeStatus.skipped;
        } else if (Date.now() > time) {
          status = StopTimeStatus.departed;
        }

        stopTimeInstanceData.push({
          serviceDate: startDate,
          tripId,
          stopId,
          predictedTime: time,
          status,
        });
      }
      await this.model.setStopTimeUpdates(stopTimeInstanceData);
    }
  }
}
