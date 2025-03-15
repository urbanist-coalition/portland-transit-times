import { Redis, RedisOptions } from "ioredis";

// Create a singleton instance
let redisInstance: Redis | null = null;

/**
 * Creates and returns a Redis client instance
 * Maintains a singleton pattern to avoid multiple connections
 */
export function getRedisClient(options: RedisOptions = {}): Redis {
  if (redisInstance) {
    return redisInstance;
  }

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

  // Store instance for reuse
  redisInstance = client;
  return client;
}

/**
 * Closes the Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
    console.log("Redis connection closed");
  }
}
