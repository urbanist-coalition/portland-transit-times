# Portland Maine Transit Tracker

This is a stops-based transit tracker for Portland Maine's transit. Brought to you by the [Urbanist Coalition of Portland](https://urbanistportland.me).

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

[Official Tracker](https://gpmetro.org/1631/Bus-Tracker-and-Trip-Planner)

## Getting Started

```bash
docker compose -f docker-compose.dev.yml up -d   # redis, nginx for the site and tiles
npm run worker                                   # feeds -> Redis -> files
```

Open [http://localhost:8080](http://localhost:8080).

The worker is the only thing that writes. It loads the GTFS and GTFS-realtime
feeds into Redis, rebuilds the site when the static feed changes, and every
second writes what the pages need as files: `_data/arrivals/<code>.json`,
`_data/alerts.json`, `_data/vehicle-positions.json`, and the arrivals block of
every stop page. nginx serves `_site` and `_data`; nothing runs at request
time.

To work on templates without the worker, `npm run site:watch` rebuilds `_site`
on change — the pages will say "Loading arrivals" until the worker fills them
in.

The Next.js app it replaces is still here and still runs (`npm run dev`, on
:3000) until the last page has moved.

## The map

`/by-location` is not a React page. It is plain HTML, CSS and JavaScript in
`public/map/`, served through a rewrite in `next.config.ts`, and it draws
[MapLibre](https://maplibre.org) vector tiles built by the
[gtfs-route-tiles](https://github.com/urbanist-coalition/gtfs-route-tiles)
pipeline.

There is no React on that page because there is nothing for it to do. Every
route line and every stop is in the tile bundle, so the browser fetches only
the tiles it is looking at and the renderer handles panning, zooming and
labelling. The page's own code covers the parts the tiles do not: stop popups,
the live vehicle feed, the theme, and the nav menu.

### Serving the tiles

The bundle is a directory of static files — two PMTiles archives (basemap and
transit), a light and a dark style, sprite sheets, and glyph ranges — produced
by the pipeline's `out/web`. It is served at `/tiles` by an nginx container
(`nginx-tiles.conf`), which matters for one reason: PMTiles archives are read
with HTTP range requests, and nginx serves those from disk natively.

| | how `/tiles` is served | where the bundle comes from |
|---|---|---|
| development | Next rewrites `/tiles` to `TILES_URL` | `TILES_DIR`, mounted into the dev tile container (defaults to `../gtfs-route-tiles/out/web`) |
| production | nginx-proxy routes `/tiles/` to the tile container | `TILES_DIR` on the host |

So in development:

```bash
# build the bundle once, in a checkout of gtfs-route-tiles
./pipeline.sh

# then, here
TILES_DIR=/path/to/gtfs-route-tiles/out/web docker compose -f docker-compose.dev.yml up -d
TILES_URL=http://localhost:8001 npm run dev
```

Rebuilding the bundle is how the map changes: new routes, new stops, restyled
lines and new basemap data all come from re-running the pipeline and swapping
the directory. Nothing in this repo needs to change for that.

### Browser dependencies

MapLibre and the PMTiles protocol shim are npm dependencies like any other, but
the map page has no bundler behind it, so `scripts/copy-map-vendor.mjs` copies
them into `public/map/vendor/` (gitignored). `npm run dev` and `npm run build`
both do this automatically.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
