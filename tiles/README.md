# gtfs-route-tiles

Turns a GTFS feed and OpenStreetMap into a **static website** of vector tiles:
a geographic transit map with bundled, overlap-free route lines and stops.

No tile server, no backend. The build produces a directory of files; anything
that honours HTTP range requests can serve it.

```
out/web/
  basemap.pmtiles    112 MB   OpenStreetMap, OpenMapTiles schema, z0-14
  transit.pmtiles    332 KB   routes + stops, z9-16
  style.json                  CARTO Voyager, repointed at the above
  sprite.png/.json            one pie per distinct route set at a stop
  fonts/              11 MB   glyph ranges
  index.html                  MapLibre GL
```

## Build

Needs Python 3.12, Java 21 (for the basemap), and loom's `gtfs2graph`, `topo`
and `loom` on `PATH` (or `LOOM_BIN` pointing at them).

```bash
pip install -r requirements.txt
./pipeline.sh          # ~5 min the first time; the basemap dominates
python serve.py out/web
```

Or `docker build -t gtfs-tiles . && docker run --rm -v "$(pwd)/out:/app/out" \
-v "$(pwd)/vendor:/app/vendor" gtfs-tiles`.

Defaults build the Greater Portland (Maine) bus network. Override with
`GTFS_URL`, `AREA`, `MODE` — see the header of `pipeline.sh`.

## How it works

```
GTFS ──> gtfs2graph ──> topo ──> loom ──┬──> loom-overview.geojson  (z9-13)
                                        └──> loom-detail.geojson    (z14-16)
                                                    │
OSM ──> planetiler ──> basemap.pmtiles              ├──> transit.pmtiles
                                                    └──> style.json + sprites
```

[loom](https://github.com/ad-freiburg/loom) does the hard part: merging
overlapping route geometry into a shared graph and solving the line ordering
that minimises crossings at shared corridors. Everything downstream just draws
its answer.

Two things are worth knowing because they are not obvious:

**Line offsets are not baked into geometry.** Each edge carries its slot in the
bundle as a tile attribute, and MapLibre offsets lines in *screen* space with a
data-driven `line-offset`. So offsets stay pixel-constant at fractional zoom,
and nothing about a line's rendered position depends on which tile it landed
in.

**Two line graphs, chosen by zoom.** A route's two directions on a divided road
sit ~20-40 m apart. Below z14 that is under 1.5 px and they must read as one
line; above it they must not. No single `topo -d` satisfies both — mid-range
values are the worst, merging unstably along a road whose carriageway gap
varies. So the pipeline builds an aggressively merged graph for low zooms and a
barely merged one for high zooms, and serves each over the zooms it suits.

Stops come from the feed rather than the graph, at real kerbside positions, with
one pie slice per route that actually *stops* there — a marker spanning the
corridor would imply every route in the bundle stops, which is false at 72% of
multi-route stops in this feed.

## Scripts

| | |
|---|---|
| `pipeline.sh` | end to end; every stage skips work already on disk |
| `make_graphs.sh` | the two line graphs (`run_loom.sh` twice) |
| `make_transit_tiles.py` | line graphs + GTFS -> `transit.pmtiles` |
| `make_style.py` | style, glyphs, sprites, page -> `out/web` |
| `serve.py` | static server with HTTP range support |

`python -m http.server` will **not** work: PMTiles is read by fetching byte
ranges, and without 206 responses the client pulls the whole basemap per tile.

## Attribution

Required, and set automatically in the style:

> © OpenStreetMap contributors · © OpenMapTiles · © CARTO

Map data is ODbL. The CARTO Voyager style is vendored under BSD-3 (code) and
CC-BY 4.0 (design) — see `vendor/README.md`. CARTO's tile *service* is not used.
