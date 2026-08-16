import type { NextConfig } from "next";

/**
 * Where the vector tile bundle lives, when it is not already reachable at
 * /tiles on this origin.
 *
 * In production nginx-proxy routes /tiles/ straight to the tile container, so
 * the archives never pass through Node — a PMTiles read is a long stream of
 * small range requests, and nginx serves those from disk far better than we
 * would. In development there is no proxy in front, so Next forwards /tiles to
 * wherever TILES_URL points (docker-compose.dev.yml puts it on :8001).
 */
const tilesUrl = process.env.TILES_URL;

/**
 * Where the worker's JSON snapshots are served, for as long as this app still
 * hosts the map page. The static site serves them itself at /data; this is
 * only so the transitional copy on :3000 keeps working.
 */
const dataUrl = process.env.DATA_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        // The map is a plain HTML page under public/, not a React route. It
        // keeps its old URL so links, bookmarks and the nav menu are unchanged.
        { source: "/by-location", destination: "/map/index.html" },
        ...(tilesUrl
          ? [{ source: "/tiles/:path*", destination: `${tilesUrl}/:path*` }]
          : []),
        ...(dataUrl
          ? [{ source: "/data/:path*", destination: `${dataUrl}/:path*` }]
          : []),
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(nextConfig);
