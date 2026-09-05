# Portland Maine Transit Tracker

A stops-based transit tracker for Greater Portland Metro, brought to you by the
[Urbanist Coalition of Portland](https://urbanistportland.me).

[Official Tracker](https://gpmetro.org/1631/Bus-Tracker-and-Trip-Planner)

## How it works

The site is files. nginx serves them, and nothing runs at request time — there
is no application server, no API, and no framework in the browser.

```
GTFS (schedule)  ->  builder  ->  releases/<id>/  ->  flip `current`
                                    site/   pages, built by Eleventy
                                    tiles/  the map bundle
                                    data/   the JSON those pages poll
                                        ^
GTFS-realtime    ->  worker  ---------- +          nginx  ->  reader
```

A release is built from one feed download and becomes live in a single rename.
The worker owns nothing static: it polls the realtime feeds, joins them onto
the current release's schedule, and every second writes out what the pages
need:

| file | rewritten | why |
|---|---|---|
| `data/arrivals/<code>.json` | on each feed refresh (~5s) | the stop page polls it as times tick over |
| `data/alerts.json` | when alerts change | fetched once per page load |
| `data/vehicle-positions.json` | every second | the map's live buses |
| `site/stops/<code>/index.html` | on each feed refresh, and each minute | so a stop page arrives with real times in it, not a skeleton |
| `site/trips/<slug>/index.html` | while that bus is running | the same, for the ~150 trips out on the road at once |
| `site/stops/<code>/display/<device>/display.bin` | when the times shown actually change, and at most every 30 seconds | the e-ink panels, which flash for four seconds every time they redraw |

Identical writes are skipped, so nginx can keep answering conditional requests
with a 304 instead of resending an unchanged payload.

Stop and trip pages are rebuilt — 656 and 1,345 of them, in about two seconds —
whenever the feed or the code changes, because a stop's name, number and route
pills, and a trip's whole timetable, live in their HTML rather than in a payload
every visitor downloads.

Tapping an arrival opens its trip: every stop that bus makes and when it is due
at each, with live times written in while it is running and its timetable put
back when it finishes.

### No framework, on purpose

Pages are Nunjucks templates in `site/`, built by [Eleventy](https://11ty.dev).
Everything interactive is a plain ES module in `public/js/`, loaded with
`<script type="module">` — no bundler, no build step for JavaScript, and no
dependencies in the browser except Google Analytics, and MapLibre on the map.

The shared pieces are `public/js/render-arrivals.js` and
`public/js/render-trip.js`, which render the arrivals list and a trip's stops to
HTML. The build and the worker import them in Node to fill in each page; the
browser imports the same files to keep the times moving. One renderer means the
first paint and the first refresh cannot disagree — and because both pages get
the word for a late bus from the same function, one cannot call it late while
the other calls it on time. `public/js/package.json` marks that directory as ESM
so Node can import the very files the browser loads.

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

### The panels

A few stops have a solar-powered e-ink display bolted to them, and those are
served a rendered bitmap rather than a page: the hardware has no browser, and
often not enough memory to hold one frame twice.

`/stops/<code>/display/<device>/display.bin` is a packed 1-bit framebuffer and
nothing else — no header, no length, no metadata. At 800x480 that is 100 bytes
a row and exactly 48,000 bytes, whatever is drawn on it, which a
microcontroller can stream from the socket straight into the panel without a
decoder. What the file cannot state, the firmware has to be told: **the
most-significant bit is leftmost, row 0 is the top, and a _clear_ bit is ink** —
so a blank frame is all `0xFF`, which is what the panel's own clear routine
writes. That is the point: the buffer goes into panel SRAM untouched, and a
frame the firmware had to invert first may as well have been a PNG.
`display.bmp` beside it is the same pixels behind a 62-byte header that says
all three, so a browser can open it — it exists to be looked at, not to be
fetched by hardware.

The device is in the path because geometry is the part a second panel model
changes. `src/lib/display/profile.ts` holds the registry; `displays.json` says
which stops have hardware, and nothing outside that list is rendered.

Drawing is `src/lib/display/`, and it shares this codebase's usual arrangement
from one level up: no markup is shared with the website, because a panel has
none, but `predictionStatus` is. A panel on a shelter and the page in a rider's
hand must not be able to disagree about whether a bus is late. Type is blitted
from `atlas.ts`, a table of glyphs thresholded to 1 bit when it was baked — see
`scripts/build-font-atlas.mjs`, which is a build step precisely so that no font
rasterizer ends up in the loop that writes every stop page on the site.

A frame is rewritten only when both are true: 30 seconds have passed, and what
a rider would read has actually changed — compared *before* the frame's "as of"
line is applied, or the clock alone would make every frame different and the
comparison worthless.

That second condition is the one that matters, because the panel has no partial
refresh: every frame it takes is four seconds of flashing black and white in
front of whoever is waiting. So an unchanged frame is never written, and a panel
that polls and finds nothing new gets a 304 with no body and does not redraw.
How often it redraws otherwise is the firmware's polling interval, not this —
the 30 seconds only bounds how stale the frame it collects can be. A full pass
over ten panels costs about five milliseconds.

```bash
npm run render:display             # every installation, into _displays/
npm run render:display -- 1117     # one stop, hardware or not
npm run build:font-atlas           # only to change a size or a weight
```

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
stop pages, with no feed artifact at all.

## Deploying

On a new host the basemap has to exist before the first release, because it
comes from OpenStreetMap rather than the transit feed and is built in its own
container:

```bash
cp .env.example .env    # hostname and certificate address, at minimum
make basemap            # ~2 minutes, capped at 1 GB
make run
```

A release build refuses to start one, rather than quietly running planetiler
inside a container sized for loom.

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

### Environment

| variable | what it does |
|---|---|
| `IMG_TAG` | image tag to run; `make` derives it from the commit |
| `VIRTUAL_HOST`, `LETSENCRYPT_*` | nginx-proxy and certificates |
| `BUILD_SCHEDULE` | cron for the release builder (default: every 10 minutes) |
| `HEARTBEAT_BUILD`, `HEARTBEAT_TILES` | pinged at the start, end and failure of each stage |
| `TILES_FROM` | use a prebuilt map bundle instead of running the pipeline |
| `DISPLAYS_FILE` | where the e-ink installation list lives (default `displays.json`) |
| `APP_VERSION` | override the commit as the release's version |
