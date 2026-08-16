/**
 * @file What the worker knows, in memory.
 *
 * This replaces Redis. With the API tier gone, exactly one process reads any of
 * this, and the whole of it — a feed's schedule and a few seconds of realtime —
 * fits comfortably in that process's heap. What Redis was providing was a
 * sorted set per stop, which is an array and a binary search.
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
} from "@/types";

import {
  ARRIVALS_LIMIT,
  DEFAULT_WINDOW,
  ExpansionWindow,
  departuresAfter,
  expandInstances,
} from "./expand";
import { StaticFeed } from "./types";

/** The identity a scheduled departure and a prediction about it share. */
const updateKey = ({ serviceDate, tripId, stopId }: StopTimeInstanceBase) =>
  `${serviceDate}:${tripId}:${stopId}`;

export class TransitStore {
  private feed: StaticFeed | null = null;
  private byStop = new Map<string, StopTimeInstance[]>();
  private routesById = new Map<string, Route>();
  private tripsById = new Map<string, Trip>();
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
    this.byStop = expandInstances(this.feed, now, this.timeZone, this.window);
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

  trip(tripId: string): Trip | undefined {
    return this.tripsById.get(tripId);
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
   * keeps its scheduled time, which is what the timetable promises.
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
      return {
        ...instance,
        predictedTime: update?.predictedTime || instance.scheduledTime,
        status: update?.status || StopTimeStatus.scheduled,
      };
    });
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
