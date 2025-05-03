import {
  Alert,
  LiveStopTimeInstance,
  Route,
  RouteWithShape,
  Stop,
  StopTimeInstance,
  StopTimeInstanceBase,
  StopTimeStatus,
  StopTimeUpdate,
  Trip,
  VehiclePosition,
} from "@/types";
import { Redis, RedisOptions } from "ioredis";

export interface Model {
  // Static

  getRoutes(): Promise<Route[]>;
  getRoutesWithShape(): Promise<RouteWithShape[] | null>;
  getRoute(routeId: string): Promise<Route | null>;
  setRoutes(routes: RouteWithShape[]): Promise<void>;

  getTrips(): Promise<Trip[]>;
  getTrip(tripId: string): Promise<Trip | null>;
  setTrips(trips: Trip[]): Promise<void>;

  getStops(): Promise<Stop[]>;
  getStop(stopId: string): Promise<Stop | null>;
  setStops(stops: Stop[]): Promise<void>;

  // Real-time

  getAlerts(): Promise<Alert[]>;
  setAlerts(alerts: Alert[]): Promise<void>;

  getVehiclePositions(): Promise<VehiclePosition[]>;
  getVehiclePositionsRaw(): Promise<string | null>;
  getVehiclePositionsUpdatedAt(): Promise<Date | null>;
  setVehiclePositions(
    vehicles: VehiclePosition[],
    updatedAt: Date
  ): Promise<void>;

  getStopTimeInstances(
    stopId: string,
    afterTimestamp: Date,
    limit: number
  ): Promise<LiveStopTimeInstance[]>;
  setStopTimeInstances(stopTimes: StopTimeInstance[]): Promise<void>;
  setStopTimeUpdates(
    stopTimes: StopTimeUpdate[],
    updatedAt: Date
  ): Promise<void>;
  cleanupStopTimeInstances(beforeTimestamp: Date): Promise<void>;

  // Used for specific stop polling
  getStopUpdatedAt(stopId: string): Promise<Date | null>;
  // Used for the worker to skip writing if the GTFS data hasn't changed
  getStopsLastUpdatedAt(): Promise<Date | null>;
  setStopsLastUpdatedAt(updatedAt: Date): Promise<void>;
}

// TODO: these methods should really stage and then commit the data to avoid consistency issues
export class RedisModel implements Model {
  private redis: Redis;

  // Static Data

  private routeHash = "routes";
  private routesWithShapeKey = "routes_with_shapes";
  private tripHash = "trips";
  private stopHash = "stops";

  // Real-time Data

  private alertKey = "alerts";

  private vehiclePositionKey = "vehicle_positions";
  private vehiclePositionUpdatedAtKey = "vehicle_positions_updated_at";

  private stopTimeInstanceHash = "stop_time_instances";
  private stopTimeUpdateHash = "stop_time_updates";
  private stopTimeSortedSetPrefix = "stop_time_sorted_set";
  private stopUpdatedAtKey = "stop_updated_at";
  private stopsLastUpdatedAtKey = "stop_last_updated_at";

  constructor(options: RedisOptions = {}) {
    // Get the Redis URL from environment variables or use default
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

    // Set default options that apply regardless of connection method
    const defaultOptions: RedisOptions = {
      connectTimeout: 10000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 50, 2000), // Exponential backoff with max
    };

    // Create a new Redis instance using the URL
    const client = new Redis(redisUrl, {
      ...defaultOptions,
      ...options, // Allow overriding defaults with passed options
    });

    // Setup event handlers for connection
    client.on("connect", () => {
      console.log("Redis client connected successfully");
    });

    client.on("error", (err) => {
      console.error("Redis connection error:", err);
    });

    client.on("reconnecting", () => {
      console.log("Redis client reconnecting...");
    });
    this.redis = client;
  }

  private async getHash<T>(hashName: string): Promise<T[]> {
    const all = await this.redis.hgetall(hashName);
    return Object.values(all).map((value) => JSON.parse(value));
  }

  private async getHashById<T>(
    hashName: string,
    id: string
  ): Promise<T | null> {
    const value = await this.redis.hget(hashName, id);
    return value ? JSON.parse(value) : null;
  }

  private async batchSet<T>(
    hashName: string,
    data: T[],
    getId: (t: T) => string
  ): Promise<void> {
    const tempHashName = `${hashName}:temp`;
    const pipeline = this.redis.pipeline();
    pipeline.del(tempHashName);

    for (const item of data) {
      const serialized =
        typeof item === "object" && item !== null
          ? JSON.stringify(item)
          : String(item);
      pipeline.hset(tempHashName, getId(item), serialized);
    }
    const results = await pipeline.exec();
    for (const [error] of results || []) {
      if (error) {
        console.error("Pipeline command failed:", error);
        throw error;
      }
    }
    // This goes after exec because exec may throw an error if building the temp hash doesn't work
    //   in that case we don't want to rename the temp hash
    await this.redis.rename(tempHashName, hashName);
  }

  // Static Data

  async getRoutes(): Promise<Route[]> {
    return this.getHash<RouteWithShape>(this.routeHash);
  }

  async getRoutesWithShape(): Promise<RouteWithShape[]> {
    const routes = await this.redis.get(this.routesWithShapeKey);
    return routes ? JSON.parse(routes) : [];
  }

  async getRoute(routeId: string): Promise<RouteWithShape | null> {
    return this.getHashById<RouteWithShape>(this.routeHash, routeId);
  }

  async setRoutes(routes: RouteWithShape[]): Promise<void> {
    await this.batchSet(
      this.routeHash,
      routes.map(({ shapes: _a, ...route }) => route),
      (route) => route.routeId
    );
    await this.redis.set(this.routesWithShapeKey, JSON.stringify(routes));
  }

  async getTrips(): Promise<Trip[]> {
    return this.getHash<Trip>(this.tripHash);
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return this.getHashById<Trip>(this.tripHash, tripId);
  }

  async setTrips(trips: Trip[]): Promise<void> {
    await this.batchSet(this.tripHash, trips, (trip) => trip.tripId);
  }

  async getStops(): Promise<Stop[]> {
    return this.getHash<Stop>(this.stopHash);
  }

  async getStop(stopId: string): Promise<Stop | null> {
    return this.getHashById<Stop>(this.stopHash, stopId);
  }

  async setStops(stops: Stop[]): Promise<void> {
    await this.batchSet(this.stopHash, stops, (stop) => stop.stopId);
  }

  // Real-time Data

  async getAlerts(): Promise<Alert[]> {
    const alerts = await this.redis.get(this.alertKey);
    return alerts ? JSON.parse(alerts) : [];
  }

  async setAlerts(alerts: Alert[]): Promise<void> {
    await this.redis.set(this.alertKey, JSON.stringify(alerts));
  }

  async getVehiclePositions(): Promise<VehiclePosition[]> {
    const vehiclePositions = await this.redis.get(this.vehiclePositionKey);
    return vehiclePositions ? JSON.parse(vehiclePositions) : [];
  }

  async getVehiclePositionsUpdatedAt(): Promise<Date | null> {
    const updatedAt = await this.redis.get(this.vehiclePositionUpdatedAtKey);
    return updatedAt ? new Date(updatedAt) : null;
  }

  async getVehiclePositionsRaw(): Promise<string | null> {
    return await this.redis.get(this.vehiclePositionKey);
  }

  async setVehiclePositions(
    vehicles: VehiclePosition[],
    updatedAt: Date
  ): Promise<void> {
    await this.redis
      .multi()
      .set(this.vehiclePositionKey, JSON.stringify(vehicles))
      .set(this.vehiclePositionUpdatedAtKey, updatedAt.toUTCString())
      .exec();
  }

  async getStopTimeInstances(
    stopId: string,
    afterTimestamp: Date,
    limit: number
  ): Promise<LiveStopTimeInstance[]> {
    const key = `${this.stopTimeSortedSetPrefix}:${stopId}`;
    const stopTimeInstanceKeys = await this.redis.zrangebyscore(
      key,
      afterTimestamp.getTime(),
      "+inf",
      "LIMIT",
      0,
      limit
    );

    // hmget breaks if the keys are empty
    if (stopTimeInstanceKeys.length === 0) return [];

    const stopTimeInstancesP = this.redis.hmget(
      this.stopTimeInstanceHash,
      ...stopTimeInstanceKeys
    );

    const stopTimeUpdatesP = this.redis.hmget(
      this.stopTimeUpdateHash,
      ...stopTimeInstanceKeys
    );

    const [stopTimeInstances, stopTimeUpdates] = await Promise.all([
      stopTimeInstancesP,
      stopTimeUpdatesP,
    ]);

    const liveStopTimeInstances: LiveStopTimeInstance[] = [];
    for (let i = 0; i < stopTimeInstances.length; i++) {
      const maybeStopTimeInstance = stopTimeInstances[i];
      if (!maybeStopTimeInstance) continue;
      const maybeStopTimeUpdate = stopTimeUpdates[i];

      const stopTimeInstance: StopTimeInstance = JSON.parse(
        maybeStopTimeInstance
      );
      const stopTimeUpdate: StopTimeUpdate | undefined | null =
        maybeStopTimeUpdate && JSON.parse(maybeStopTimeUpdate);

      liveStopTimeInstances.push({
        ...stopTimeInstance,
        predictedTime:
          stopTimeUpdate?.predictedTime || stopTimeInstance.scheduledTime,
        status: stopTimeUpdate?.status || StopTimeStatus.scheduled,
      });
    }

    return liveStopTimeInstances;
  }

  private stopTimeInstanceKey({
    serviceDate,
    tripId,
    stopId,
  }: StopTimeInstanceBase): string {
    return `${serviceDate}:${tripId}:${stopId}`;
  }

  async setStopTimeInstances(stopTimes: StopTimeInstance[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const stopTime of stopTimes) {
      const key = this.stopTimeInstanceKey(stopTime);
      const serialized = JSON.stringify(stopTime);
      this.redis.pipeline();
      // TODO: convert to a stage/commit model
      // Doing these two writes without a transaction is safe because we only query
      //   stop time instances based on the sorted set, so we don't need to worry about
      pipeline.hset(this.stopTimeInstanceHash, key, serialized);
      pipeline.zadd(
        `${this.stopTimeSortedSetPrefix}:${stopTime.stopId}`,
        // Don't overwrite existing data, this prevents us from overwriting realtime updates
        //   This method has a slight flaw in that if a stop time is rescheduled but it has
        //   the same trip and stopId but no live updates yet it will not be updated.
        "NX",
        stopTime.scheduledTime,
        key
      );
      // NOTE: We don't set the stopUpdatedAt key here because we don't need real-time
      //  updates for static schedule information
    }
    const results = await pipeline.exec();
    for (const [error] of results || []) {
      if (error) {
        console.error("Pipeline command failed:", error);
        throw error;
      }
    }
  }

  async setStopTimeUpdates(
    stopTimes: StopTimeUpdate[],
    updatedAt: Date
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const stopTime of stopTimes) {
      const key = this.stopTimeInstanceKey(stopTime);
      const serialized = JSON.stringify(stopTime);
      // WARNING: this introduces inconsistency during a miniscule window
      //   Stop Time Instances may be returned in a different order than their estimated
      //   arrival time if the get happens in between these two commands. We are not
      //   using multi/exec because if we put them all in one big multi/exec it would
      //   block the redis server (which would be a disaster because this runs every second).
      //   We can't use one transaction per pair because then we couldn't pipeline all of
      //   the updates, we would need to wait for each one to finish before starting the next.
      //   This would slow down updates anyway, which could also lead to stale data. Given
      //   how frequent polling is and how rarely stops change order this is the best option.
      //   The prediction is written before the sorted set because it is more important to
      //   display the correct prediction than the correct order.
      pipeline.hset(this.stopTimeUpdateHash, key, serialized);
      pipeline.zadd(
        `${this.stopTimeSortedSetPrefix}:${stopTime.stopId}`,
        // Only write if it already exists
        "XX",
        stopTime.predictedTime,
        key
      );
      // WARNING: this introduces another inconsistency during a miniscule window that will
      //   only impact real-time updates because they are cached based on this timestamp.
      //   Real-time updates will only be picked up if this timestamp changes. It is possible
      //   that we will poll for an update after the update is written but before the
      //   stopUpdatedAt key is set. That means the API will consider this unchanged and
      //   it won't return the update. This is better than if we set the updatedAt key
      //   first because in that case the client would get old data for that update
      //   and then never get the new data because the client will use the newer updatedAt.
      //   This means the client could miss an update entirely isntead of getting
      //   it on the next poll. This caching behavior allows us to poll more often
      //   so this strategy should result in faster updates overall. There is no way
      //   to completely avoid showing the user data that is at least a little stale.
      //   This just minimizes it as much as possible.
      pipeline.hset(
        this.stopUpdatedAtKey,
        stopTime.stopId,
        updatedAt.toUTCString()
      );
    }
    const results = await pipeline.exec();
    for (const [error] of results || []) {
      if (error) {
        console.error("Pipeline command failed:", error);
        throw error;
      }
    }
  }

  async cleanupStopTimeInstances(beforeTimestamp: Date): Promise<void> {
    const keys = await this.redis.keys(`${this.stopTimeSortedSetPrefix}:*`);
    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      const stopKeys = await this.redis.zrangebyscore(
        key,
        "-inf",
        beforeTimestamp.getTime(),
        "LIMIT",
        0,
        100
      );
      for (const stopKey of stopKeys) {
        pipeline.hdel(this.stopTimeInstanceHash, stopKey);
        pipeline.hdel(this.stopTimeUpdateHash, stopKey);
      }
      pipeline.zremrangebyscore(key, "-inf", beforeTimestamp.getTime());
    }
    const results = await pipeline.exec();
    for (const [error] of results || []) {
      if (error) {
        console.error("Pipeline command failed:", error);
        throw error;
      }
    }
  }

  async getStopUpdatedAt(stopId: string): Promise<Date | null> {
    const updatedAt = await this.redis.hget(this.stopUpdatedAtKey, stopId);
    return updatedAt ? new Date(updatedAt) : null;
  }

  async getStopsLastUpdatedAt(): Promise<Date | null> {
    const updatedAt = await this.redis.get(this.stopsLastUpdatedAtKey);
    return updatedAt ? new Date(updatedAt) : null;
  }

  async setStopsLastUpdatedAt(updatedAt: Date): Promise<void> {
    await this.redis.set(this.stopsLastUpdatedAtKey, updatedAt.toUTCString());
  }
}

let modelInstance: RedisModel | null = null;

export function getModel(): RedisModel {
  if (!modelInstance) {
    modelInstance = new RedisModel();
  }
  return modelInstance;
}
