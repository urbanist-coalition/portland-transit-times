/**
 * Every stop, read out of Redis at build time.
 *
 * This is the whole reason the site has a build step: stops change when the
 * GTFS feed changes, which is nightly at most, so their names, codes and route
 * pills belong in the HTML rather than in a payload every visitor downloads.
 * The worker rebuilds the site when it loads a new feed.
 *
 * Reads the `stops` hash directly rather than going through lib/model.ts,
 * which is TypeScript and comes with the app's whole dependency graph. The
 * cost is knowing the key name in one more place; see RedisModel.stopHash.
 */

const Redis = require("ioredis");

const STOP_HASH = "stops";

module.exports = async function stops() {
  // CI builds the site to prove the templates and config are sound, with no
  // Redis to read. Without stops there are no stop pages, which is fine for
  // that purpose and never what you want anywhere else.
  if (process.env.SKIP_STOPS) {
    console.log("[stops] SKIP_STOPS set — building without stop pages");
    return [];
  }

  const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 2,
    // A build that silently produces a site with no stops is worse than one
    // that fails, so don't sit in a retry loop waiting for a Redis that isn't
    // there.
    retryStrategy: (attempt) => (attempt > 3 ? null : 200),
  });

  try {
    const raw = await redis.hgetall(STOP_HASH);
    const all = Object.values(raw).map((value) => JSON.parse(value));
    const usable = all
      // The arrivals pages are addressed by stop code; a stop without one
      // cannot have a page, and nothing can link to it.
      .filter((stop) => stop.stopCode)
      .sort((a, b) =>
        a.stopCode.localeCompare(b.stopCode, undefined, { numeric: true })
      );

    if (usable.length === 0) {
      throw new Error(
        `No stops in Redis under "${STOP_HASH}" — is the worker running?`
      );
    }

    console.log(`[stops] ${usable.length} stops from Redis`);
    return usable;
  } finally {
    redis.quit();
  }
};
