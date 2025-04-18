import {
  LineData,
  LineDataSlim,
  ServiceAlert,
  StopData,
  StopTimeData,
  VehicleData,
} from "@/types";
import { Redis, RedisOptions } from "ioredis";
import { addDays } from "date-fns";

function getRedisClient(options: RedisOptions = {}): Redis {
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

  return client;
}

export interface Model {
  getServiceAlerts(): Promise<ServiceAlert[]>;
  setServiceAlerts(alerts: ServiceAlert[]): Promise<void>;
  getVehicles(): Promise<VehicleData[]>;
  setVehicles(vehicles: VehicleData[]): Promise<void>;
  getTripRouteID(tripID: string): Promise<string | null>;
  setTripRouteID(trips: [string, string][]): Promise<void>;
  getLinesSlim(): Promise<Record<string, LineDataSlim>>;
  getLineSlim(lineId: string): Promise<LineDataSlim | null>;
  setLinesSlim(line: LineDataSlim[]): Promise<void>;
  getLines(): Promise<Record<string, LineData>>;
  getLine(lineId: string): Promise<LineData | null>;
  setLines(line: LineData[]): Promise<void>;
  getStops(): Promise<Record<string, StopData>>;
  getStop(stopId: string): Promise<StopData | null>;
  setStops(stops: StopData[]): Promise<void>;
  getStopTimes(
    stopId: string,
    afterTimestamp: Date,
    limit?: number
  ): Promise<StopTimeData[]>;
  setStopTimes(stopTimes: StopTimeData[]): Promise<void>;
}

export class RedisModel implements Model {
  private redis: Redis;
  private serviceAlertKey = "service_alerts";
  private vehicleKey = "vehicles";
  private tripRouteHash = "trip_route";
  private lineSlimHash = "line_slim";
  private lineHash = "line";
  private stopHash = "stop";

  private stopTimePrefix = "stop_time";
  private stopTimeSortedSetPrefix = "stop_time_sorted_set";

  constructor() {
    this.redis = getRedisClient();
  }

  private async batchSet<T>(
    hashName: string,
    data: [string, T][]
  ): Promise<void> {
    const tempHashName = `${hashName}:temp`;
    const pipeline = this.redis.pipeline();
    pipeline.del(tempHashName);

    for (const [id, item] of data) {
      const serialized =
        typeof item === "object" && item !== null
          ? JSON.stringify(item)
          : String(item);
      pipeline.hset(tempHashName, id, serialized);
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

  async getServiceAlerts(): Promise<ServiceAlert[]> {
    const result = await this.redis.get(this.serviceAlertKey);
    return result ? JSON.parse(result) : [];
  }

  async setServiceAlerts(alerts: ServiceAlert[]): Promise<void> {
    await this.redis.set(this.serviceAlertKey, JSON.stringify(alerts));
  }

  async getVehicles(): Promise<VehicleData[]> {
    const result = await this.redis.get(this.vehicleKey);
    return result ? JSON.parse(result) : [];
  }

  async setVehicles(vehicles: VehicleData[]): Promise<void> {
    await this.redis.set(
      this.vehicleKey,
      JSON.stringify(vehicles),
      "EX",
      60 * 60
    );
  }

  async getTripRouteID(tripID: string): Promise<string | null> {
    return this.redis.hget(this.tripRouteHash, tripID);
  }

  async setTripRouteID(trips: [string, string][]): Promise<void> {
    await this.batchSet(this.tripRouteHash, trips);
  }

  async getLinesSlim(): Promise<Record<string, LineDataSlim>> {
    const result = await this.redis.hgetall(this.lineSlimHash);
    const lines: Record<string, LineDataSlim> = {};
    for (const [key, value] of Object.entries(result)) {
      lines[key] = JSON.parse(value);
    }
    return lines;
  }

  async getLineSlim(lineId: string): Promise<LineDataSlim | null> {
    const result = await this.redis.hget(this.lineSlimHash, lineId);
    return result ? JSON.parse(result) : null;
  }

  async setLinesSlim(line: LineDataSlim[]): Promise<void> {
    await this.batchSet(
      this.lineSlimHash,
      line.map((line) => [line.lineId, line])
    );
  }

  async getLines(): Promise<Record<string, LineData>> {
    const result = await this.redis.hgetall(this.lineHash);
    const lines: Record<string, LineData> = {};
    for (const [key, value] of Object.entries(result)) {
      lines[key] = JSON.parse(value);
    }
    return lines;
  }

  async getLine(lineId: string): Promise<LineData | null> {
    const result = await this.redis.hget(this.lineHash, lineId);
    return result ? JSON.parse(result) : null;
  }

  async setLines(line: LineData[]): Promise<void> {
    await this.batchSet(
      this.lineHash,
      line.map((line) => [line.lineId, line])
    );
  }

  async getStops(): Promise<Record<string, StopData>> {
    const result = await this.redis.hgetall(this.stopHash);
    const stops: Record<string, StopData> = {};
    for (const [key, value] of Object.entries(result)) {
      stops[key] = JSON.parse(value);
    }
    return stops;
  }

  async getStop(stopId: string): Promise<StopData | null> {
    const result = await this.redis.hget(this.stopHash, stopId);
    return result ? JSON.parse(result) : null;
  }

  async setStops(stops: StopData[]): Promise<void> {
    await this.batchSet(
      this.stopHash,
      stops.map((stop) => [stop.stopId, stop])
    );
  }

  async getStopTimes(
    stopId: string,
    afterTimestamp: Date,
    limit: number = 10
  ): Promise<StopTimeData[]> {
    const key = `${this.stopTimePrefix}:${stopId}`;
    const result = await this.redis.zrangebyscore(
      key,
      afterTimestamp.getTime(),
      "+inf",
      "LIMIT",
      0,
      limit
    );
    return result.map((s) => JSON.parse(s));
  }

  async setStopTimes(stopTimes: StopTimeData[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const stopTime of stopTimes) {
      const { serviceDate, serviceId, tripId, stopId } = stopTime;
      const stopTimeKey = `${serviceDate}:${serviceId}:${tripId}:${stopId}`;

      pipeline.zadd(
        `${this.stopTimeSortedSetPrefix}:${stopTime.stopId}`,
        stopTime.predictedTime,
        stopTimeKey
      );

      pipeline.hset(
        `${this.stopTimePrefix}:${stopId}`,
        stopTimeKey,
        JSON.stringify(stopTime)
      );
    }
    await pipeline.exec();
  }
}
