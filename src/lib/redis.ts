import { ServiceAlert, VehicleData } from "@/types";
import { Redis, RedisOptions } from "ioredis";

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

class Model {
  private redis: Redis;
  private serviceAlertKey = "service_alerts";
  private vehicleKey = "vehicles";
  private tripRouteKey = "trip_route";

  constructor() {
    this.redis = getRedisClient();
  }
  async set(key: string, value: string): Promise<string> {
    return this.redis.set(key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async getServiceAlerts(): Promise<ServiceAlert[]> {
    const result = await this.redis.get(this.serviceAlertKey);
    return result ? JSON.parse(result) : [];
  }

  async setServiceAlerts(alerts: ServiceAlert[]): Promise<void> {
    await this.redis.set(
      this.serviceAlertKey,
      JSON.stringify(alerts),
      "EX",
      60 * 60
    );
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
    return this.redis.get(`${this.tripRouteKey}:${tripID}`);
  }

  async setTripRouteID(trips: [string, string][]): Promise<void> {
    const ttl = 48 * 60 * 60; // 48h in seconds
    const redisPipeline = this.redis.pipeline();
    for (const [trip_id, route_id] of trips) {
      redisPipeline.set(`${this.tripRouteKey}:${trip_id}`, route_id, "EX", ttl);
    }
    await redisPipeline.exec();
  }
}

const model = new Model();

export default model;
