import { Redis, RedisOptions } from "ioredis";

export interface Location {
  lat: number;
  lng: number;
}

// Static Data

export interface Route {
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
}

export interface RouteWithShape extends Route {
  // Denormalized Shape Info
  shapes: Location[][];
}

export interface Trip {
  tripId: string;
  routeId: string;
  serviceId: string;
  shapeId: string;

  tripHeadsign: string;
}

export interface Stop {
  stopId: string;
  stopCode: string;
  stopName: string;
  location: Location;

  // Denormalized Route Info
  routes: Route[];
}

// Real-time Data

export interface Alert {
  id: string; // Corresponds to the feed entity ID
  headerText: string;
  descriptionText: string;
}

export interface VehiclePosition {
  vehicleId: string;
  position: Location;

  // Denormalized Route Info
  route: Route;
}

export enum StopTimeStatus {
  scheduled = "SCHEDULED",
  skipped = "SKIPPED",
  departed = "DEPARTED",
}

export interface StopTimeInstanceBase {
  serviceDate: string;
  tripId: string;
  stopId: string;
}

export interface StopTimeUpdate extends StopTimeInstanceBase {
  predictedTime: number; // Unix timestamp in seconds
  status: StopTimeStatus;
}

export interface StopTimeInstance extends StopTimeInstanceBase {
  scheduledTime: number; // Unix timestamp in seconds

  // Denormalized Route Info
  route: Route;

  // Denormalized Trip Info
  trip: Trip;
}

export type LiveStopTimeInstance = StopTimeInstance & StopTimeUpdate;

export interface Model {
  // Static

  getRoutes(): Promise<RouteWithShape[]>;
  getRoute(routeId: string): Promise<RouteWithShape | null>;
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
  setVehiclePositions(vehicles: VehiclePosition[]): Promise<void>;

  getStopTimeInstances(
    stopId: string,
    afterTimestamp: Date,
    limit: number
  ): Promise<LiveStopTimeInstance[]>;
  setStopTimeInstances(stopTimes: StopTimeInstance[]): Promise<void>;
  setStopTimeUpdates(stopTimes: StopTimeUpdate[]): Promise<void>;
  cleanupStopTimeInstances(beforeTimestamp: Date): Promise<void>;
}

export class RedisModel implements Model {
  private redis: Redis;

  // Static Data

  private routeHash = "routes";
  private tripHash = "trips";
  private stopHash = "stops";

  // Real-time Data

  private alertKey = "alerts";
  private vehiclePositionKey = "vehicle_positions";

  private stopTimeInstanceHash = "stop_time_instances";
  private stopTimeUpdateHash = "stop_time_updates";
  private stopTimeSortedSetPrefix = "stop_time_sorted_set";

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

  async getRoutes(): Promise<RouteWithShape[]> {
    return this.getHash<RouteWithShape>(this.routeHash);
  }

  async getRoute(routeId: string): Promise<RouteWithShape | null> {
    return this.getHashById<RouteWithShape>(this.routeHash, routeId);
  }

  async setRoutes(routes: RouteWithShape[]): Promise<void> {
    await this.batchSet(this.routeHash, routes, (route) => route.routeId);
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

  async setVehiclePositions(vehicles: VehiclePosition[]): Promise<void> {
    await this.redis.set(this.vehiclePositionKey, JSON.stringify(vehicles));
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
      pipeline.hset(this.stopTimeInstanceHash, key, serialized);
      pipeline.zadd(
        `${this.stopTimeSortedSetPrefix}:${stopTime.stopId}`,
        // Don't overwrite existing data
        "NX",
        stopTime.scheduledTime,
        key
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

  async setStopTimeUpdates(stopTimes: StopTimeUpdate[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const stopTime of stopTimes) {
      const key = this.stopTimeInstanceKey(stopTime);
      const serialized = JSON.stringify(stopTime);
      pipeline.hset(this.stopTimeUpdateHash, key, serialized);
      pipeline.zadd(
        `${this.stopTimeSortedSetPrefix}:${stopTime.stopId}`,
        // Only write if it already exists
        "XX",
        stopTime.predictedTime,
        key
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
}

let modelInstance: RedisModel | null = null;

export function getModel(): RedisModel {
  if (!modelInstance) {
    modelInstance = new RedisModel();
  }
  return modelInstance;
}
