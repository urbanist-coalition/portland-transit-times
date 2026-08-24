import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  Alert,
  StopTimeStatus,
  VehiclePosition,
  VehicleProgress,
  StopTimeUpdate,
} from "@/types";
import { TransitStore } from "@/lib/feed/store";
import { formatInTimeZone } from "date-fns-tz";
import { GTFSSystem } from "@/lib/gtfs/types";
import { indexBy } from "../utils";

const { STOPPED_AT } =
  GtfsRealtimeBindings.transit_realtime.VehiclePosition.VehicleStopStatus;
const { SKIPPED } =
  GtfsRealtimeBindings.transit_realtime.TripUpdate.StopTimeUpdate
    .ScheduleRelationship;

export class GTFSRealtimeLoader {
  system: GTFSSystem;
  store: TransitStore;

  constructor(system: GTFSSystem, store: TransitStore) {
    this.system = system;
    this.store = store;
  }

  private gtfsFetch(url: string) {
    const headers = new Headers();
    if (this.system.authorization) {
      headers.append("Authorization", this.system.authorization);
    }
    return fetch(url, { headers });
  }

  async loadVehiclePositions() {
    console.log("Loading vehicle positions...");

    const response = await this.gtfsFetch(this.system.vehicleURL);
    const currentUpdatedAt = this.store.getVehiclePositionsUpdatedAt();

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );
    const maybeTimestamp = feed.header?.timestamp;
    const updatedAt = maybeTimestamp
      ? new Date(this.longToNumber(maybeTimestamp) * 1000)
      : new Date();

    if (currentUpdatedAt && currentUpdatedAt >= updatedAt) {
      return;
    }

    const routes = this.store.routes();
    const routesById = indexBy(routes, "routeId");

    const vehiclesData: VehiclePosition[] = [];
    const progressData: VehicleProgress[] = [];
    for (const entity of feed.entity) {
      if (!entity.vehicle) continue;

      const vehicleId = entity.vehicle?.vehicle?.id;
      const tripId = entity.vehicle?.trip?.tripId;
      const lat = entity.vehicle?.position?.latitude;
      const lng = entity.vehicle?.position?.longitude;
      const rawBearing = entity.vehicle?.position?.bearing;

      /*
       * Where the bus has got to, which is the only thing in either feed that
       * can say whether it has actually left a stop. Collected before the
       * checks below because it needs neither a position nor a route: a
       * vehicle that reports its stop and nothing else still settles the
       * question the map cannot draw it for.
       */
      const stopId = entity.vehicle?.stopId;
      const currentStatus = entity.vehicle?.currentStatus;
      if (tripId && stopId) {
        const sequence = entity.vehicle?.currentStopSequence;
        progressData.push({
          tripId,
          stopId,
          // GPMETRO sends 0 for every vehicle, which is not a sequence; the
          // store falls back to looking the stop up in the schedule.
          ...(typeof sequence === "number" && sequence > 0 ? { sequence } : {}),
          stopped: currentStatus === STOPPED_AT,
        });
      }

      if (!vehicleId || !tripId || !lat || !lng) {
        console.warn("Invalid vehicle data:", entity);
        continue;
      }

      const trip = this.store.trip(tripId);
      if (!trip) {
        console.warn("Missing trip", tripId);
        continue;
      }

      const route = routesById.get(trip.routeId);
      if (!route) {
        console.warn("Missing route", trip.routeId);
        continue;
      }

      const vehicleData: VehiclePosition = {
        vehicleId,
        position: { lat, lng },
        route,
        ...(typeof rawBearing === "number" && Number.isFinite(rawBearing)
          ? { bearing: rawBearing }
          : {}),
      };

      vehiclesData.push(vehicleData);
    }
    this.store.setVehiclePositions(JSON.stringify(vehiclesData), updatedAt);
    this.store.setVehicleProgress(progressData);

    if (process.env.VEHICLE_POSITIONS_HEARTBEAT_URL) {
      await fetch(process.env.VEHICLE_POSITIONS_HEARTBEAT_URL);
    }
  }

  private mapAlertEntityToServiceAlert(
    entity: GtfsRealtimeBindings.transit_realtime.IFeedEntity
  ) {
    const alert = entity.alert;
    if (!alert) return null;

    const headerTranslations = alert.headerText?.translation;
    const descriptionTranslations = alert.descriptionText?.translation;
    if (!headerTranslations || !descriptionTranslations) return null;

    const headerEn = headerTranslations.find((t) =>
      t.language?.startsWith("en")
    );
    const descEn = descriptionTranslations.find((t) =>
      t.language?.startsWith("en")
    );
    if (!headerEn || !descEn) return null;

    return {
      id: entity.id,
      headerText: headerEn.text,
      descriptionText: descEn.text,
    };
  }

  async loadServiceAlerts() {
    console.log("Loading service alerts...");

    const response = await this.gtfsFetch(this.system.alertsURL);

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

    this.store.setAlerts(alerts);

    if (process.env.SERVICE_ALERTS_HEARTBEAT_URL) {
      await fetch(process.env.SERVICE_ALERTS_HEARTBEAT_URL);
    }
  }

  private longToNumber(n: Long | number): number {
    return typeof n === "number" ? n : n.toNumber();
  }

  async loadTripUpdates() {
    console.log("Loading trip updates...");

    const response = await this.gtfsFetch(this.system.tripUpdatesURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const maybeTimestamp = feed.header?.timestamp;
    const updatedAt = maybeTimestamp
      ? new Date(this.longToNumber(maybeTimestamp) * 1000)
      : new Date();

    const currentUpdatedAt = this.store.getPredictionsUpdatedAt();
    if (currentUpdatedAt && currentUpdatedAt >= updatedAt) {
      return;
    }

    for (const entity of feed.entity) {
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
        /*
         * Departure, to the same event the timetable names.
         *
         * normalizeFeed times a call by `departure_time`, because a rider
         * standing at a stop is boarding rather than alighting. Taking the
         * arrival here compared two different events and the difference was
         * the layover: the 4:48 from Hancock St + Thames St is reported with
         * the arrival the bus made at 4:43, so the page called it five minutes
         * early and then said it had gone, with the bus still standing there.
         *
         * A trip's last call is the exception, and needs no special case: the
         * schedule times it by arrival because nobody boards it, and the feed
         * gives it an arrival and no departure, so the fallback picks the same
         * event from both sides.
         */
        const rawTime =
          stopTimeUpdate.departure?.time || stopTimeUpdate.arrival?.time;
        const stopId = stopTimeUpdate.stopId;

        if (!rawTime || !stopId) {
          console.warn("Missing time or stopId:", stopTimeUpdate);
          continue;
        }
        const time = this.longToNumber(rawTime) * 1000;

        /*
         * Whether the bus has gone is not asked here, because this feed cannot
         * answer it. While a bus stands at a stop the agency reports the
         * arrival it has already made and moves the departure to whenever the
         * feed was built, so both times are in the past for the whole layover —
         * measured against a bus laying over at Maine Mall JC Penney, for the
         * thirteen minutes between pulling in at 5:02 and its 5:15 departure.
         *
         * The vehicle feed does answer it, and TransitStore.vehicleStatus asks
         * it there.
         *
         * The cancellation test is by name because the number it used to
         * compare against, 2, is NO_DATA rather than SKIPPED — so a stop the
         * agency had nothing to say about was labelled "Canceled", and a stop
         * it really had cancelled was not.
         */
        const status =
          stopTimeUpdate.scheduleRelationship === SKIPPED
            ? StopTimeStatus.skipped
            : StopTimeStatus.scheduled;

        stopTimeInstanceData.push({
          serviceDate: startDate,
          tripId,
          stopId,
          predictedTime: time,
          status,
        });
      }
      this.store.setStopTimeUpdates(stopTimeInstanceData, updatedAt);
    }

    if (process.env.TRIP_UPDATES_HEARTBEAT_URL) {
      await fetch(process.env.TRIP_UPDATES_HEARTBEAT_URL);
    }
  }
}
