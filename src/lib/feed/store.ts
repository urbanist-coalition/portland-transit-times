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
  StopTimeInstanceBase,
  StopTimeStatus,
  StopTimeUpdate,
  Trip,
  TripCall,
  VehicleProgress,
} from "@/types";

import {
  ARRIVALS_LIMIT,
  DEFAULT_WINDOW,
  ExpansionWindow,
  TripCallInstance,
  expandInstances,
  indexAfter,
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

/**
 * How far behind its timetable a departure can be and still be listed.
 *
 * A stop's window is a scheduled one — the last ten minutes, so someone who
 * just missed a bus sees why — and a bus running late falls out of it while
 * still on its way, which is exactly when a rider needs the row. So a call the
 * agency says has not gone is kept past that, at its scheduled place in the
 * list, up to this far back.
 *
 * Ninety minutes rather than open-ended because past that, "not gone" stops
 * describing a late bus and starts describing a bug — a vehicle the agency lost
 * track of, a trip left running by a producer that never closed it out. A row
 * pinned to the top of a stop page forever is the worse failure of the two.
 */
const RETAIN_LATE_MS = 90 * 60 * 1000;

/** Where a bus has got to, once its stop has been placed in its trip. */
interface VehicleReport {
  /** The call it is standing at, or driving towards. */
  sequence: number;
  /** Standing at that call rather than approaching it. */
  stopped: boolean;
}

export class TransitStore {
  private feed: StaticFeed | null = null;
  private byStop = new Map<string, TripCallInstance[]>();
  private byTrip = new Map<string, TripCallInstance[]>();
  /** The service dates each trip runs on within the expansion. */
  private tripRunnings = new Map<string, string[]>();
  private routesById = new Map<string, Route>();
  private tripsById = new Map<string, Trip>();
  private stopsById = new Map<string, Stop>();
  /** Each trip's calls in the order it makes them, with no date attached. */
  private callsByTrip = new Map<string, ScheduledCall[]>();
  /** The day the current expansion was made for, so it can be redone. */
  private expandedFor = "";

  private updates = new Map<string, StopTimeUpdate>();
  /** Where each running bus has got to, by `tripKey`. */
  private progress = new Map<string, VehicleReport>();
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
    this.tripRunnings = new Map();
    for (const instances of byTrip.values()) {
      const { tripId, serviceDate } = instances[0]!;
      (
        this.tripRunnings.get(tripId) ??
        this.tripRunnings.set(tripId, []).get(tripId)!
      ).push(serviceDate);
    }
    // A vehicle's place was resolved against the expansion that has just been
    // replaced, so it means nothing now. The next poll is a second away.
    this.progress = new Map();
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
        ...(call.timepoint ? { timepoint: true as const } : {}),
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
   * Where each reported bus has got to, placed in the trip it is running.
   *
   * Two things have to be resolved before a position means anything about a
   * call. Which running: the vehicle feed names a trip but not the day it
   * started, and the expansion holds four days of them, so the running whose
   * start is nearest now is the one the bus is on — they are a day apart, so
   * there is nothing to be ambiguous about. And where in the trip: GPMETRO
   * sends `currentStopSequence` as 0 for every vehicle, so the stop it names
   * is looked up in the schedule instead.
   *
   * Replaced wholesale, unlike the predictions, because a vehicle that has
   * stopped reporting has stopped saying anything — and what this settles is
   * whether a bus is standing at a stop, which is only true while it is being
   * observed.
   */
  setVehicleProgress(progress: VehicleProgress[], now = Date.now()): void {
    const placed = new Map<string, VehicleReport>();

    for (const vehicle of progress) {
      let running: TripCallInstance[] | undefined;
      let distance = Infinity;
      for (const date of this.tripRunnings.get(vehicle.tripId) ?? []) {
        const instances = this.byTrip.get(tripKey(date, vehicle.tripId));
        if (!instances?.length) continue;
        const away = Math.abs(instances[0]!.scheduledTime - now);
        if (away < distance) {
          distance = away;
          running = instances;
        }
      }
      if (!running) continue;

      /*
       * Long finished, and the feed has not forgotten the bus yet.
       *
       * Bounded by how late a bus can plausibly be rather than by liveTrips'
       * ten minutes, because a bus *is* the thing running late: its last
       * scheduled call passing is what being late looks like, and the ten
       * minute bound threw the vehicle away at exactly the moment it was the
       * only thing that could say the bus had not gone.
       */
      const last = running[running.length - 1]!;
      if (last.scheduledTime < now - RETAIN_LATE_MS) continue;

      /*
       * A loop route calls at the same stop twice, and a stop id alone cannot
       * say which of the two the bus is at. The first is taken, which is the
       * conservative half of the guess: it marks fewer calls behind the bus,
       * so the error is a row that stays on the page a little longer rather
       * than one that vanishes while it can still be caught.
       */
      const sequence =
        vehicle.sequence ??
        running.find((call) => call.stopId === vehicle.stopId)?.sequence;
      if (sequence === undefined) continue;

      placed.set(tripKey(running[0]!.serviceDate, vehicle.tripId), {
        sequence,
        stopped: vehicle.stopped,
      });
    }

    this.progress = placed;
  }

  /**
   * What the vehicle feed says about one call: the bus is standing at it, or
   * it is behind the bus. Undefined where no vehicle is reporting this running,
   * or the bus has not reached the call yet.
   *
   * This is the only place either feed can answer "has it left?", and the
   * reason the question is asked here rather than in the loader — see
   * StopTimeStatus.
   */
  private vehicleStatus(
    instance: TripCallInstance
  ): StopTimeStatus.departed | StopTimeStatus.atStop | undefined {
    const report = this.progress.get(
      tripKey(instance.serviceDate, instance.tripId)
    );
    if (!report) return undefined;
    if (instance.sequence < report.sequence) return StopTimeStatus.departed;
    if (instance.sequence > report.sequence) return undefined;
    return report.stopped ? StopTimeStatus.atStop : undefined;
  }

  /**
   * What to call one departure, given a prediction about it and a bus seen
   * somewhere along its trip.
   *
   * A cancellation outranks both: a bus standing at a stop it is not going to
   * serve is still not going to serve it.
   */
  private callStatus(
    update: StopTimeUpdate | undefined,
    vehicle: StopTimeStatus | undefined
  ): StopTimeStatus {
    if (update?.status === StopTimeStatus.skipped)
      return StopTimeStatus.skipped;
    return vehicle ?? update?.status ?? StopTimeStatus.scheduled;
  }

  /**
   * Whether the agency is still saying this departure is coming.
   *
   * Only ever true on evidence. A bus being tracked somewhere short of the call
   * is the strongest form of it — that is a vehicle on its way — and a
   * prediction still naming a time in the future is the weaker one. Silence is
   * not evidence: a call nobody has mentioned since the timetable was written
   * is left to fall out of the window on schedule, which is what a rider
   * reading an unreported row is already being told.
   */
  private stillToCome(instance: TripCallInstance, now: number): boolean {
    const vehicle = this.vehicleStatus(instance);
    if (vehicle === StopTimeStatus.departed) return false;
    if (vehicle === StopTimeStatus.atStop) return true;

    const update = this.updates.get(updateKey(instance));
    // Cancelled is not late. Nothing is coming, so nothing is held.
    if (update?.status === StopTimeStatus.skipped) return false;

    // Tracked, and not yet up to this call.
    if (this.progress.has(tripKey(instance.serviceDate, instance.tripId))) {
      return true;
    }

    return update !== undefined && update.predictedTime >= now;
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
   *
   * `after` bounds the list by the *timetable*, which is the right bound for a
   * bus nobody has reported and the wrong one for a bus running late: it is
   * still coming, and dropping it at the moment it is most wanted is how a
   * rider ends up watching a stop with nothing on the page. So the walk back
   * before `after` picks those up again — see stillToCome — and they keep their
   * scheduled place, so the list still reads in timetable order.
   */
  departures(
    stopId: string,
    after: number,
    limit: number = ARRIVALS_LIMIT,
    now: number = Date.now()
  ): LiveStopTimeInstance[] {
    const instances = this.byStop.get(stopId) ?? [];
    const start = indexAfter(instances, after);

    const late: TripCallInstance[] = [];
    for (let index = start - 1; index >= 0; index--) {
      const instance = instances[index]!;
      // Measured from now rather than from `after`, so the bound is the ninety
      // minutes it says it is rather than ninety plus the window.
      if (instance.scheduledTime < now - RETAIN_LATE_MS) break;
      if (this.stillToCome(instance, now)) late.unshift(instance);
    }

    const scheduled = [
      ...late,
      ...instances.slice(start, start + Math.max(limit - late.length, 0)),
    ].slice(0, limit);

    return scheduled.map((instance) => {
      const update = this.updates.get(updateKey(instance));
      const vehicle = this.vehicleStatus(instance);
      if (!update && !vehicle) return instance;
      return {
        ...instance,
        predictedTime: update?.predictedTime || instance.scheduledTime,
        status: this.callStatus(update, vehicle),
        /*
         * A bus seen at the stop is the agency saying something about this
         * exact call, as much as a prediction is — and it is the stronger of
         * the two, because it was observed rather than forecast.
         */
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
          const vehicle = this.vehicleStatus(instance);
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
            status: this.callStatus(update, vehicle),
            ...(instance.timepoint ? { timepoint: true as const } : {}),
            ...(update || vehicle ? { reported: true as const } : {}),
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
