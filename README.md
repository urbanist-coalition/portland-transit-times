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
| `data/arrivals/<code>.json` | on each feed refresh (~5s) | the stop page polls it as times tick over |
| `data/alerts.json` | when alerts change | fetched once per page load |
| `data/vehicle-positions.json` | every second | the map's live buses |
| `site/stops/<code>/index.html` | on each feed refresh, and each minute | so a stop page arrives with real times in it, not a skeleton |

Identical writes are skipped, so nginx can keep answering conditional requests
with a 304 instead of resending an unchanged payload.

Stop pages are rebuilt — all 656 of them, in about a second — whenever the feed
or the code changes, because a stop's name, number and route pills live in its
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
pipeline in [`tiles/`](tiles/): an OpenStreetMap basemap and every route and
stop, as two PMTiles archives with a light and a dark style. It is Python and a
compiled CLI rather than TypeScript, which is why it has its own directory
rather than its own repository — one commit describes both halves of a
release. The browser fetches only the tiles it
is looking at, so there is nothing for a framework to re-render on pan or zoom.

nginx serves that bundle at `/tiles` from `TILES_DIR`. The only hard
requirement is HTTP range requests, which nginx does natively for static files
— a PMTiles archive is read by fetching byte ranges out of one large file.

## Getting Started

```bash
npm run build:release              # feed -> releases/<id>, and flips `current`
docker compose -f docker-compose.dev.yml up -d     # nginx
npm run worker                                     # realtime -> the current release
```

The first build needs the map pipeline, which wants Python, a JRE and loom. If
you have none of those, point it at a bundle someone else built:
`TILES_FROM=tiles/out/web npm run build:release`. Subsequent builds reuse the
map whenever the feed has not changed.

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

`make run` starts the stack: nginx, the builder, the worker, and the
certificate companion. Releases live in a volume on disk; the JSON the pages
poll lives in tmpfs, keyed by release, and the release points at it with a
relative symlink so one flip switches everything.

The basemap is the exception, and deliberately: it comes from OpenStreetMap
rather than the transit feed, wants far more memory than anything else here,
and changes on nobody's schedule. It is a profile of its own, capped so an
overrun can only kill itself:

```bash
docker compose --profile basemap run --rm basemap
```

The next release picks the result up. Its URL carries a content hash, so
browsers re-fetch those 117 MB only when they have actually changed.
