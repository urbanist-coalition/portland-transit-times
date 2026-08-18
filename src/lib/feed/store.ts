/**
 * @file What the worker knows, in memory.
 *
 * Exactly one process reads any of this — the worker that wrote it — and the
 * whole of it, a feed's schedule and a few seconds of realtime, fits
 * comfortably in that process's heap. So it is plain objects: a sorted array
 * per stop and a binary search over it, with no database in the middle.
 *
 * Two halves with different lifetimes:
 *
 *   static     read from the release's artifact, expanded into dated
 *              departures around today. Changes when a release does.
 *   realtime   predictions, vehicles and alerts, replaced every few seconds
 *              from the agency's feeds. Lost on restart and refetched within a
 *              second, because every poll is a complete snapshot.
 *
 * Reads are synchronous. Nothing here waits on anything.
 */

import { readFile } from "node:fs/promises";

import { groupBy } from "@/lib/utils";

import {
  Alert,
  LiveStopTimeInstance,
  Route,
  Stop,
  StopTimeInstance,
  StopTimeInstanceBase,
  StopTimeStatus,
  StopTimeUpdate,
  Trip,
  TripCall,
} from "@/types";

import {
  ARRIVALS_LIMIT,
  DEFAULT_WINDOW,
  ExpansionWindow,
  TripCallInstance,
  departuresAfter,
  expandInstances,
  tripKey,
} from "./expand";
import { ScheduledCall, StaticFeed } from "./types";

/** The identity a scheduled departure and a prediction about it share. */
const updateKey = ({ serviceDate, tripId, stopId }: StopTimeInstanceBase) =>
  `${serviceDate}:${tripId}:${stopId}`;

/**
 * How long after its last call a trip still counts as live.
 *
 * Predictions are kept until the small hours — see prunePredictions — so
 * without a bound every trip that has run today would still be offering the
 * page a set of times, hours after the bus reached the end of the line.
 */
const TRIP_LIVE_WINDOW_MS = 10 * 60 * 1000;

export class TransitStore {
  private feed: StaticFeed | null = null;
  private byStop = new Map<string, StopTimeInstance[]>();
  private byTrip = new Map<string, TripCallInstance[]>();
  private routesById = new Map<string, Route>();
  private tripsById = new Map<string, Trip>();
  private stopsById = new Map<string, Stop>();
  /** Each trip's calls in the order it makes them, with no date attached. */
  private callsByTrip = new Map<string, ScheduledCall[]>();
  /** The day the current expansion was made for, so it can be redone. */
  private expandedFor = "";

  private updates = new Map<string, StopTimeUpdate>();
  private vehiclePositionsRaw: string | null = null;
  private vehiclePositionsUpdatedAt: Date | null = null;
  private alerts: Alert[] = [];
  private predictionsUpdatedAt: Date | null = null;

  constructor(
    private timeZone: string,
    private window: ExpansionWindow = DEFAULT_WINDOW
  ) {}

  /** Reads a release's artifact and expands it around `now`. */
  async loadStatic(path: string, now = Date.now()): Promise<void> {
    const feed: StaticFeed = JSON.parse(await readFile(path, "utf8"));
    this.feed = feed;
    this.routesById = new Map(
      feed.routes.map((route) => [route.routeId, route])
    );
    this.tripsById = new Map(feed.trips.map((trip) => [trip.tripId, trip]));
    this.stopsById = new Map(feed.stops.map((stop) => [stop.stopId, stop]));
    this.callsByTrip = groupBy(feed.calls, "tripId");
    for (const calls of this.callsByTrip.values()) {
      calls.sort((a, b) => a.sequence - b.sequence);
    }
    this.expand(now);
    console.log(
      `[store] ${feed.stops.length} stops, ${feed.trips.length} trips, ` +
        `${this.instanceCount()} departures in the window`
    );
  }

  /**
   * Rebuilds the expansion for the day `now` falls in.
   *
   * Called on load and once a day. The previous implementation rebuilt this
   * only when the *feed* changed, so a feed that went unchanged for longer than
   * the window left the app with nothing upcoming at all.
   */
  expand(now = Date.now()): void {
    if (!this.feed) return;
    const { byStop, byTrip } = expandInstances(
      this.feed,
      now,
      this.timeZone,
      this.window
    );
    this.byStop = byStop;
    this.byTrip = byTrip;
    this.expandedFor = new Date(now).toDateString();
  }

  expandIfStale(now = Date.now()): void {
    if (new Date(now).toDateString() !== this.expandedFor) this.expand(now);
  }

  get loaded(): boolean {
    return this.feed !== null;
  }

  get feedHash(): string | undefined {
    return this.feed?.feedHash;
  }

  stops(): Stop[] {
    return this.feed?.stops ?? [];
  }

  routes(): Route[] {
    return this.feed?.routes ?? [];
  }

  trips(): Trip[] {
    return this.feed?.trips ?? [];
  }

  trip(tripId: string): Trip | undefined {
    return this.tripsById.get(tripId);
  }

  /**
   * A trip's calls as the timetable states them: in order, with a time of day
   * and no date.
   *
   * This is what a trip page says when the bus is not running, and it is the
   * same thing the build wrote into the page — which is the point. A page left
   * holding live times by a worker that stopped has to be put back, and putting
   * it back means rendering the timetable again rather than trusting whatever
   * is currently in the file.
   */
  tripSchedule(tripId: string): TripCall[] {
    return (this.callsByTrip.get(tripId) ?? []).map((call) => {
      const stop = this.stopsById.get(call.stopId);
      return {
        stopId: call.stopId,
        stopCode: stop?.stopCode ?? "",
        stopName: stop?.stopName ?? "This stop",
        sequence: call.sequence,
        time: call.time,
      };
    });
  }

  route(routeId: string): Route | undefined {
    return this.routesById.get(routeId);
  }

  instanceCount(): number {
    let total = 0;
    for (const instances of this.byStop.values()) total += instances.length;
    return total;
  }

  /**
   * The join: scheduled departures at a stop, with whatever the agency has
   * said about them since.
   *
   * A departure with no prediction is not late, it is simply unreported — it
   * keeps its scheduled time, which is what the timetable promises, and it is
   * sent without prediction fields at all. Filling them in from the schedule
   * was how a stop page came to say "On Time" about 92% of its rows, including
   * tomorrow morning's, hours before any vehicle could have reported one.
   */
  departures(
    stopId: string,
    after: number,
    limit: number = ARRIVALS_LIMIT
  ): LiveStopTimeInstance[] {
    const scheduled = departuresAfter(
      this.byStop.get(stopId) ?? [],
      after,
      limit
    );
    return scheduled.map((instance) => {
      const update = this.updates.get(updateKey(instance));
      if (!update) return instance;
      return {
        ...instance,
        predictedTime: update.predictedTime || instance.scheduledTime,
        status: update.status || StopTimeStatus.scheduled,
        reported: true,
      };
    });
  }

  /**
   * The trips the agency is currently saying something about, as the rows a
   * trip page shows.
   *
   * Driven by the predictions rather than by the clock: a trip is here because
   * the feed is talking about it, which is exactly when its page has more to
   * say than the timetable it was built with. Everything else keeps the
   * timetable.
   *
   * Keyed by trip id alone, because that is what a page is addressed by. A
   * trip runs once a service day, so two runnings with live predictions at the
   * same moment would mean one is a bus finishing very late; the one starting
   * nearer to now is the one a reader means.
   */
  liveTrips(now: number): Map<string, TripCall[]> {
    const running = new Set<string>();
    for (const update of this.updates.values()) {
      running.add(tripKey(update.serviceDate, update.tripId));
    }

    const live = new Map<string, TripCall[]>();
    /** When the running already chosen for a trip starts, so a second can win. */
    const starts = new Map<string, number>();

    for (const key of running) {
      const instances = this.byTrip.get(key);
      if (!instances?.length) continue;

      // Long finished; the feed simply has not forgotten it yet.
      const last = instances[instances.length - 1]!;
      if (last.scheduledTime < now - TRIP_LIVE_WINDOW_MS) continue;

      const tripId = instances[0]!.tripId;
      const startsAt = instances[0]!.scheduledTime;
      const chosen = starts.get(tripId);
      if (
        chosen !== undefined &&
        Math.abs(chosen - now) <= Math.abs(startsAt - now)
      ) {
        continue;
      }
      starts.set(tripId, startsAt);

      const timetable = new Map(
        this.tripSchedule(tripId).map((call) => [call.sequence, call])
      );

      /*
       * How far behind the timetable the bus was at the last stop the agency
       * reported, carried forward to the ones it did not.
       *
       * The feed predicts a subset of a trip's stops — 17 to 39 of up to 55 —
       * and GTFS-RT says a delay holds until something supersedes it. Without
       * that, an unreported stop keeps its scheduled time and the column of
       * times runs backwards: a bus fifteen minutes late reaching Yarmouth
       * Town Hall at 4:38 would be shown reaching Yarmouth Hannaford, two
       * stops earlier, at 4:21 — seventeen minutes before it got there.
       *
       * Zero until the first report, because a stop ahead of anything the
       * agency has said is genuinely unknown rather than on time.
       */
      let carried = 0;

      live.set(
        tripId,
        instances.map((instance) => {
          const update = this.updates.get(updateKey(instance));
          if (update) carried = update.predictedTime - instance.scheduledTime;
          const stop = this.stopsById.get(instance.stopId);
          return {
            stopId: instance.stopId,
            stopCode: stop?.stopCode ?? "",
            stopName: stop?.stopName ?? "This stop",
            sequence: instance.sequence,
            time: timetable.get(instance.sequence)?.time ?? "",
            scheduledTime: instance.scheduledTime,
            predictedTime:
              update?.predictedTime || instance.scheduledTime + carried,
            status: update?.status || StopTimeStatus.scheduled,
            ...(update ? { reported: true as const } : {}),
          };
        })
      );
    }
    return live;
  }

  // Realtime, replaced wholesale by each poll.

  setStopTimeUpdates(updates: StopTimeUpdate[], updatedAt: Date): void {
    for (const update of updates) this.updates.set(updateKey(update), update);
    this.predictionsUpdatedAt = updatedAt;
  }

  /**
   * Forgets predictions for departures that are no longer in the window, which
   * is the only reason this map would grow without bound.
   */
  prunePredictions(): void {
    const live = new Set<string>();
    for (const instances of this.byStop.values()) {
      for (const instance of instances) live.add(updateKey(instance));
    }
    for (const key of this.updates.keys()) {
      if (!live.has(key)) this.updates.delete(key);
    }
  }

  getPredictionsUpdatedAt(): Date | null {
    return this.predictionsUpdatedAt;
  }

  setVehiclePositions(raw: string, updatedAt: Date): void {
    this.vehiclePositionsRaw = raw;
    this.vehiclePositionsUpdatedAt = updatedAt;
  }

  getVehiclePositionsRaw(): string | null {
    return this.vehiclePositionsRaw;
  }

  getVehiclePositionsUpdatedAt(): Date | null {
    return this.vehiclePositionsUpdatedAt;
  }

  setAlerts(alerts: Alert[]): void {
    this.alerts = alerts;
  }

  getAlerts(): Alert[] {
    return this.alerts;
  }
}
