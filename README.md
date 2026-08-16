# Portland Maine Transit Tracker

A stops-based transit tracker for Greater Portland Metro, brought to you by the
[Urbanist Coalition of Portland](https://urbanistportland.me).

[Official Tracker](https://gpmetro.org/1631/Bus-Tracker-and-Trip-Planner)

## How it works

The site is files. nginx serves them, and nothing runs at request time — there
is no application server, no API, and no framework in the browser.

```
GTFS + GTFS-realtime  ->  worker  ->  Redis
                            |
                            +-> _site/   pages, built by Eleventy
                            +-> _data/   the JSON those pages poll
                                             |
                                          nginx  ->  reader
```

The worker is the only thing that writes. It loads the feeds into Redis, and
every second it writes out what the pages need:

| file | rewritten | why |
|---|---|---|
| `_data/arrivals/<code>.json` | on each feed refresh (~5s) | the stop page polls it as times tick over |
| `_data/alerts.json` | when alerts change | fetched once per page load |
| `_data/vehicle-positions.json` | every second | the map's live buses |
| `_site/stops/<code>/index.html` | on each feed refresh, and each minute | so a stop page arrives with real times in it, not a skeleton |

Identical writes are skipped, so nginx can keep answering conditional requests
with a 304 instead of resending an unchanged payload.

Stop pages are rebuilt — all 656 of them, in about a second — when the static
GTFS feed changes, because a stop's name, number and route pills live in its
HTML rather than in a payload every visitor downloads.

### No framework, on purpose

Pages are Nunjucks templates in `site/`, built by [Eleventy](https://11ty.dev).
Everything interactive is a plain ES module in `public/js/`, loaded with
`<script type="module">` — no bundler, no build step for JavaScript, and no
dependencies in the browser except Google Analytics, and MapLibre on the map.

The one shared piece is `public/js/render-arrivals.js`, which renders the
arrivals list to HTML. The worker imports it in Node to fill in each page; the
browser imports the same file to keep the times moving. One renderer means the
first paint and the first refresh cannot disagree. `public/js/package.json`
marks that directory as ESM so Node can import the very files the browser
loads.

### Installable, and useful with no signal

`site/sw.njk` builds a service worker that precaches every stylesheet and
module — the list and the cache name are generated from their contents, so
adding a file cannot leave it uncached and a deploy retires the old cache by
itself. Pages are network-first with a cache fallback; `/data/` is never
cached, because a cached arrivals snapshot is a lie told confidently. When the
times on screen get older than ninety seconds the page says so.

Links are prerendered through speculation rules, which is what removes the
browser's loading bar between pages. A prerendered page runs its scripts, so
anything with an effect beyond drawing — polling, recording a recent stop,
counting a pageview — goes through `whenActivated` in
`public/js/activation.js` and waits until the reader actually arrives.

### The map

`/by-location` draws [MapLibre](https://maplibre.org) vector tiles built by the
[gtfs-route-tiles](https://github.com/urbanist-coalition/gtfs-route-tiles)
pipeline: an OpenStreetMap basemap and every route and stop, as two PMTiles
archives with a light and a dark style. The browser fetches only the tiles it
is looking at, so there is nothing for a framework to re-render on pan or zoom.

nginx serves that bundle at `/tiles` from `TILES_DIR`. The only hard
requirement is HTTP range requests, which nginx does natively for static files
— a PMTiles archive is read by fetching byte ranges out of one large file.

## Getting Started

```bash
# once, in a checkout of gtfs-route-tiles
./pipeline.sh

# here
TILES_DIR=/path/to/gtfs-route-tiles/out/web \
  docker compose -f docker-compose.dev.yml up -d   # redis + nginx
npm run worker                                     # feeds -> Redis -> files
```

Open [http://localhost:8080](http://localhost:8080).

Eleventy does not prune files it no longer copies, so a renamed or deleted
asset lingers in `_site` until it is cleared by hand — `rm -rf _site/*`, not
`rm -rf _site`, which would break the container's bind mount and take the site
down until nginx restarts.

To work on templates without running the worker, `npm run site:watch` rebuilds
`_site` on change; the stop pages will say "Loading arrivals" until the worker
fills them in. `SKIP_STOPS=1 npm run site:build` builds everything except the
stop pages, with no Redis at all.

## Deploying

`make run` pulls the worker image and starts the stack: nginx, the worker,
Redis, and the certificate companion. The worker writes into two volumes the
site container reads — `site_html` on disk, so a restart serves the previous
site immediately, and `site_data` in tmpfs, since it is rewritten every few
seconds and derived entirely from Redis.

Rebuilding the map is a separate job: re-run the tile pipeline and swap
`TILES_DIR`. Nothing in this repo changes for it.
