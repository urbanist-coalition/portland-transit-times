"""Turn a loom line graph into a vector tileset (PMTiles) of transit routes.

Where the raster pipeline baked perpendicular offsets into geometry once per
zoom (draw_routes.py did this nine times over), this carries loom's line
ordering through as *attributes* and lets MapLibre do the offsetting in screen
space via a data-driven `line-offset`. Consequences:

  * one geometry set instead of one per zoom;
  * offsets stay pixel-constant at fractional zoom and during a pinch, which
    baked raster offsets can never do;
  * the tile-boundary agreement problem disappears — nothing about a feature's
    rendered position depends on which tile it was drawn into.

Each loom edge carries a `lines` array listing the routes that share it, in
loom's optimal order. MVT attributes are flat scalars, so an edge shared by
four routes becomes four features, each tagged with its slot in the bundle.

The offset/width formula follows the raster renderer it replaces: the corridor
widens from 1x (single route) to 2x base (two or more), and the lines split
that budget evenly, touching edge-to-edge. The one departure is `solo_scale`,
a ceiling on every line's width — opaque strokes read heavier than the
translucent ones this replaced, so lone routes want thinning. See
_width_factor for why it is a ceiling and not a special case.

    offset  = index - (bundle - 1) / 2                       # slot, in widths
    wfactor = min(solo_scale, min(bundle, 2) / bundle)       # width multiplier

so the style computes  line-width = base * wfactor  and
                       line-offset = offset * base * wfactor.
"""

import csv
import gzip
import io
import json
import math
import re
import zipfile
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from collections import defaultdict
from pathlib import Path

import mapbox_vector_tile
import mercantile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, MultiLineString, Point, box
from shapely.ops import linemerge
from shapely.strtree import STRtree
from tqdm import tqdm

LAYER = "routes"
GTFS_STOP_LAYER = "gtfs_stops"
EXTENT = 4096
BUFFER = 64  # MVT units of overdraw past the tile edge, so strokes/offsets
             # that lean inward from outside the tile still get drawn
EARTH_CIRCUMFERENCE = 40075016.68557849
MAX_LAT = 85.0511287798066
DEFAULT_COLOR = "#FF6B35"


def _to_mercator(lon: float, lat: float) -> tuple[float, float]:
    """lon/lat degrees -> EPSG:3857 metres.

    Tile coordinates are linear in Web Mercator, not in degrees — quantizing
    straight from lon/lat would skew every line northward or southward within
    its tile.
    """
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    x = math.radians(lon) * (EARTH_CIRCUMFERENCE / (2 * math.pi))
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * (
        EARTH_CIRCUMFERENCE / (2 * math.pi)
    )
    return (x, y)


def _hex_color(raw: str) -> str:
    h = (raw or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6 or any(c not in "0123456789abcdefABCDEF" for c in h):
        return DEFAULT_COLOR
    return f"#{h.lower()}"


def _route_sort_key(short_name: str) -> list:
    """The order a rider reads a list of routes in.

    Route names mix digits and letters — 1, 9A, 21, 24B, BRZ — so ordering them
    as text puts 21 and 24A ahead of 4. Comparing the digit runs as numbers
    gives 1, 2, 4, 5, 7, 8, 9A, 9B, 21, 24A, 24B, BRZ. The tuples keep numbers
    and text separately comparable, since Python will not order an int against
    a str.

    Consumers of these tiles sort the same way; see public/js/routes.js in the
    site that renders them.
    """
    parts = re.split(r"(\d+)", short_name)
    return [(0, int(p), "") if p.isdigit() else (1, 0, p.lower())
            for p in parts if p]


def _width_factor(bundle: int, solo_scale: float) -> float:
    """Multiplier on the base stroke width for one line in a bundle of `bundle`.

    The corridor budget is unchanged from the raster renderer: it widens from
    1x base for a lone route up to 2x base once two or more share an edge, and
    the members split that budget evenly (a triple gets 2/3 each, a quadruple
    1/2).

    `solo_scale` then caps every member, which matters because opaque lines
    read heavier than the translucent ones this replaced. Capping rather than
    special-casing bundle == 1 keeps the widths monotonic: thinning only the
    solo case would leave a lone route *thickening* from 0.7 to 1.0 as it
    merged with exactly one other route, then dropping to 0.67 at a third,
    which looks like a rendering fault rather than a design.

    solo_scale = 1.0 reproduces the raster behaviour exactly.
    """
    return min(solo_scale, min(bundle, 2) / bundle)


def load_edges(path: Path, solo_scale: float) -> list[dict]:
    """Explode each loom edge into one feature per route sharing it, then
    rechain contiguous runs back into maximal polylines.

    Rechaining matters more than it looks. loom emits every graph edge
    separately, so a route crossing ten intersections arrives as ten stubs
    that each get their own round line caps. Wherever two stubs meet, those
    caps overlap — invisible on opaque lines, but a visible dark blot on
    translucent ones, and the reason `draw_routes.py` went to the trouble of
    compositing each route through an offscreen group. It also stops
    `symbol-placement: line` from restarting its labels every 20 metres.

    Merging is `directed=True` deliberately. `line-offset` is signed relative
    to the direction of travel along the line, so chaining an edge that had to
    be reversed to fit would silently flip which side of the centreline that
    stretch draws on. Direction-safe merging gives up ~1% of the available
    joint reduction to avoid that.
    """
    data = json.loads(path.read_text())
    groups: dict[tuple, list[LineString]] = defaultdict(list)

    for feature in data.get("features", []):
        geom = feature.get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        line = LineString([_to_mercator(lon, lat) for lon, lat in coords])
        if line.is_empty or line.length == 0:
            continue

        lines = (feature.get("properties") or {}).get("lines") or []
        bundle = len(lines)
        if bundle == 0:
            continue
        wfactor = _width_factor(bundle, solo_scale)
        for index, ln in enumerate(lines):
            route_id = ln.get("id") or ""
            if not route_id:
                continue
            # Only edges identical in every rendered respect may merge.
            key = (
                route_id,
                ln.get("label", "") or "",
                _hex_color(ln.get("color", "")),
                index - (bundle - 1) / 2,
                wfactor,
                bundle,
            )
            groups[key].append(line)

    before = sum(len(v) for v in groups.values())
    out: list[dict] = []
    for key, segments in groups.items():
        route_id, label, color, offset, wfactor, bundle = key
        merged = linemerge(MultiLineString(segments), directed=True)
        parts = merged.geoms if merged.geom_type == "MultiLineString" else [merged]
        props = {
            "route_id": route_id,
            "label": label,
            "color": color,
            "offset": offset,
            "wfactor": wfactor,
            "bundle": bundle,
        }
        for part in parts:
            if not part.is_empty and part.length > 0:
                out.append({"geom": part, "props": props})

    print(f"Rechained {before} loom edge-lines into {len(out)} polylines "
          f"({before - len(out)} internal joints removed)")
    return out


def load_gtfs_stops(gtfs: Path) -> tuple[list[dict], dict]:
    """Stops straight from the feed, rather than from loom's graph nodes.

    The graph-node version spans the whole corridor, which asserts that every
    route in the bundle stops there. In this feed that is false at 72% of
    multi-route stops — a route running through without stopping is exactly what
    the marker should distinguish. The graph also collapses the 47% of stops
    that have a counterpart across the street into a single node, discarding
    which kerb the pole is actually on.

    So take positions and route sets from GTFS. The cost is that a stop sits
    ~6.5 m off the drawn line instead of on it, which is under 4 px at z16 and
    is where the pole really is.

    Each stop carries its feed identifiers as well as its name, so a site
    rendering these tiles can link straight from a marker to its own page for
    that stop without matching on position or name.

    Returns the stop features plus a sprite table: one pie per distinct route
    set, keyed by a stable name the style can look up via ["get", "sprite"].
    """
    if gtfs.is_dir():
        def rd(name):
            return csv.DictReader(open(gtfs / name, encoding="utf-8-sig", newline=""))
    else:
        zf = zipfile.ZipFile(gtfs)

        def rd(name):
            return csv.DictReader(
                io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", newline=""))

    route_info = {}
    for r in rd("routes.txt"):
        # The feed's own text colour travels with the route colour: agencies
        # pick it deliberately, and it is not always what a contrast
        # calculation would choose (route 5's #00b050 is specified white).
        # Left empty when the feed omits it, rather than defaulted, so a
        # consumer can tell "unspecified" from "specified" and fall back to its
        # own contrast rule.
        text_raw = (r.get("route_text_color") or "").strip()
        route_info[r["route_id"]] = ((r.get("route_short_name") or "").strip(),
                                     _hex_color(r.get("route_color", "")),
                                     _hex_color(text_raw) if text_raw else "")
    trip2route = {t["trip_id"]: t["route_id"] for t in rd("trips.txt")}

    stop_routes: dict[str, set] = defaultdict(set)
    for row in rd("stop_times.txt"):
        rid = trip2route.get(row.get("trip_id", ""))
        if rid in route_info:
            stop_routes[row["stop_id"]].add(rid)

    positions = {}
    for row in rd("stops.txt"):
        try:
            positions[row["stop_id"]] = (
                _to_mercator(float(row["stop_lon"]), float(row["stop_lat"])),
                (row.get("stop_name") or "").strip(),
                # The rider-facing number on the pole, and the only stop
                # identifier a consuming site can link to — GTFS stop_ids are
                # feed-internal. Not every stop has one; those get "".
                (row.get("stop_code") or "").strip(),
            )
        except (KeyError, ValueError):
            continue

    # One sprite per distinct route set. Sorted by short name so the slice
    # order is stable — the same set of routes always draws the same pie.
    combos: dict[tuple, str] = {}
    sprites: dict[str, dict] = {}
    out: list[dict] = []
    for stop_id, rids in sorted(stop_routes.items()):
        if stop_id not in positions or not rids:
            continue
        pos, name, code = positions[stop_id]
        ordered = sorted(rids, key=lambda r: (_route_sort_key(route_info[r][0]), r))
        key = tuple(ordered)
        if key not in combos:
            sprite = f"pie-{len(combos)}"
            combos[key] = sprite
            sprites[sprite] = {
                "colors": [route_info[r][1] for r in ordered],
                "routes": [route_info[r][0] for r in ordered],
            }
        out.append({
            "geom": Point(pos),
            "props": {
                "name": name,
                "stop_id": stop_id,
                "stop_code": code,
                "sprite": combos[key],
                # `routes` and `route_colors` are parallel, comma-joined and in
                # the same order as the pie's slices, so a popup can rebuild
                # the route pills from the tile alone — no second data source
                # to fetch and keep in step with the feed.
                "routes": ", ".join(route_info[r][0] for r in ordered),
                "route_colors": ",".join(route_info[r][1] for r in ordered),
                "route_text_colors": ",".join(route_info[r][2] for r in ordered),
                "n_routes": len(ordered),
            },
        })
    print(f"  {gtfs}: {len(out)} stops, {len(sprites)} distinct route sets")
    return out, sprites


def build(sources: list[tuple[Path, int, int]], out_path: Path,
          attribution: str, solo_scale: float, stop_min_zoom: int,
          gtfs: Path | None, sprite_table: Path | None):
    """Tile from possibly *different* line graphs at different zooms.

    A route's two directions on a divided road are ~20 m apart. Zoomed out that
    is a fraction of a pixel and they must read as one line; zoomed in it is
    tens of pixels and drawing one line is simply wrong. No single merge
    distance satisfies both, and every attempt to find one just moves the zoom
    at which it looks bad.

    Vector tiles do not require one answer. Each zoom range gets the line graph
    generalised for it: an aggressively self-merged graph where the carriageways
    are sub-pixel, and a barely-merged one where they are resolvable. The map
    swaps representation at the boundary, the same way a basemap swaps a road
    casing for a full carriageway.
    """
    loaded: dict[Path, list[dict]] = {}
    per_zoom: dict[int, tuple[list[dict], list, STRtree]] = {}
    zoom_source: dict[int, Path] = {}
    for path, zmin, zmax in sources:
        if path not in loaded:
            feats = load_edges(path, solo_scale)
            if not feats:
                raise SystemExit(f"No usable line features in {path}")
            routes = {f["props"]["route_id"] for f in feats}
            print(f"  {path}: {len(feats)} features, {len(routes)} routes "
                  f"-> z{zmin}-{zmax}")
            loaded[path] = feats
        feats = loaded[path]
        geoms = [f["geom"] for f in feats]
        entry = (feats, geoms, STRtree(geoms))
        for z in range(zmin, zmax + 1):
            per_zoom[z] = entry
            zoom_source[z] = path

    gtfs_stops: list[dict] = []
    if gtfs:
        gtfs_stops, sprites = load_gtfs_stops(gtfs)
        if sprite_table:
            sprite_table.parent.mkdir(parents=True, exist_ok=True)
            sprite_table.write_text(json.dumps(sprites, indent=2))
            print(f"  sprite table -> {sprite_table}")

    min_zoom, max_zoom = min(per_zoom), max(per_zoom)
    missing = [z for z in range(min_zoom, max_zoom + 1) if z not in per_zoom]
    if missing:
        raise SystemExit(f"No source covers zoom(s) {missing}")

    all_geoms = [g for feats, geoms, _ in per_zoom.values() for g in geoms]
    west, south = _from_mercator(min(g.bounds[0] for g in all_geoms),
                                 min(g.bounds[1] for g in all_geoms))
    east, north = _from_mercator(max(g.bounds[2] for g in all_geoms),
                                 max(g.bounds[3] for g in all_geoms))
    print(f"Bounds: {west:.4f} {south:.4f} {east:.4f} {north:.4f}")

    tiles: dict[int, bytes] = {}
    for z in range(min_zoom, max_zoom + 1):
        feats, geoms, tree = per_zoom[z]
        # Simplify once per zoom, to roughly one MVT unit at this zoom.
        tol = (EARTH_CIRCUMFERENCE / 2 ** z) / EXTENT
        simplified = [g.simplify(tol, preserve_topology=False) for g in geoms]

        candidates = list(mercantile.tiles(west, south, east, north, z))
        written = 0
        for t in tqdm(candidates, desc=f"z{z}", unit="tile", leave=False):
            b = mercantile.xy_bounds(t)
            pad = (b.right - b.left) * BUFFER / EXTENT
            clip = box(b.left - pad, b.bottom - pad, b.right + pad, b.top + pad)

            layer_feats = []
            for i in tree.query(clip):
                idx = int(i)
                clipped = simplified[idx].intersection(clip)
                if clipped.is_empty:
                    continue
                layer_feats.append({
                    "geometry": clipped,
                    "properties": feats[idx]["props"],
                })
            gtfs_feats = []
            if z >= stop_min_zoom and gtfs_stops:
                for st in gtfs_stops:
                    if clip.contains(st["geom"]):
                        gtfs_feats.append({"geometry": st["geom"],
                                           "properties": st["props"]})

            if not layer_feats and not gtfs_feats:
                continue

            mvt_layers = []
            if layer_feats:
                mvt_layers.append({"name": LAYER, "features": layer_feats})
            if gtfs_feats:
                mvt_layers.append({"name": GTFS_STOP_LAYER, "features": gtfs_feats})

            # NB: these must go through `default_options`. Passing them as
            # bare kwargs hits a deprecated path that skips the y-axis flip,
            # producing tiles mirrored within each tile — which decodes
            # plausibly but renders wrong.
            encoded = mapbox_vector_tile.encode(
                mvt_layers,
                default_options={
                    "quantize_bounds": (b.left, b.bottom, b.right, b.top),
                    "extents": EXTENT,
                },
            )
            tiles[zxy_to_tileid(z, t.x, t.y)] = gzip.compress(encoded)
            written += 1
        print(f"z{z}: {written}/{len(candidates)} tiles had features")

    if not tiles:
        raise SystemExit("No tiles produced")

    metadata = {
        "name": "transit",
        "type": "overlay",
        "description": "GTFS routes, bundled and ordered by loom",
        "attribution": attribution,
        "vector_layers": [{
            "id": GTFS_STOP_LAYER,
            "description": "Stops from the feed: real kerbside positions, exact route set",
            "minzoom": stop_min_zoom,
            "maxzoom": max_zoom,
            "fields": {"name": "String", "stop_id": "String",
                       "stop_code": "String", "sprite": "String",
                       "routes": "String", "route_colors": "String",
                       "route_text_colors": "String", "n_routes": "Number"},
        }, {
            "id": LAYER,
            "description": "One feature per route per shared edge",
            "minzoom": min_zoom,
            "maxzoom": max_zoom,
            "fields": {
                "route_id": "String",
                "label": "String",
                "color": "String",
                "offset": "Number",
                "wfactor": "Number",
                "bundle": "Number",
            },
        }],
    }
    header = {
        "tile_type": TileType.MVT,
        "tile_compression": Compression.GZIP,
        "min_lon_e7": int(west * 1e7),
        "min_lat_e7": int(south * 1e7),
        "max_lon_e7": int(east * 1e7),
        "max_lat_e7": int(north * 1e7),
        "center_zoom": min_zoom,
        "center_lon_e7": int((west + east) / 2 * 1e7),
        "center_lat_e7": int((south + north) / 2 * 1e7),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        writer = Writer(f)
        for tile_id in sorted(tiles):  # PMTiles wants clustered (sorted) ids
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(header, metadata)

    size = out_path.stat().st_size
    print(f"Wrote {out_path} — {len(tiles)} tiles, {size / 1e6:.2f} MB")


def _from_mercator(x: float, y: float) -> tuple[float, float]:
    k = EARTH_CIRCUMFERENCE / (2 * math.pi)
    lon = math.degrees(x / k)
    lat = math.degrees(2 * math.atan(math.exp(y / k)) - math.pi / 2)
    return (lon, lat)


parser = ArgumentParser(
    description="Build a PMTiles vector tileset of transit routes from a loom "
                "line graph. Each edge is exploded into one feature per route "
                "sharing it, tagged with that route's slot in the bundle so "
                "the map style can offset lines in screen space.",
    epilog="Example:\n"
           "  python make_transit_tiles.py out/loom.geojson out/web/transit.pmtiles",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument("loom_geojson", type=Path, nargs="?",
                    help="loom output; single-source shorthand for --source")
parser.add_argument("output", type=Path, help="path to write the .pmtiles file")
parser.add_argument("--source", action="append", default=[], metavar="PATH:ZMIN-ZMAX",
                    help="line graph to use over a zoom range; repeatable. "
                         "e.g. --source overview.geojson:9-13 "
                         "--source detail.geojson:14-16")
parser.add_argument("--min-zoom", type=int, default=9,
                    help="only with the positional shorthand")
parser.add_argument("--max-zoom", type=int, default=14,
                    help="only with the positional shorthand; MapLibre overzooms "
                         "past this, so 14 still renders at z18")
parser.add_argument("--attribution", default="")
parser.add_argument("--gtfs", type=Path,
                    help="GTFS feed (zip or dir) for the kerbside stop layer")
parser.add_argument("--sprite-table", type=Path,
                    help="write the pie sprite table here for make_style.py")
parser.add_argument("--stop-min-zoom", type=int, default=14,
                    help="lowest zoom that carries the stops layer")
parser.add_argument("--solo-scale", type=float, default=0.5,
                    help="width multiplier ceiling for every line, which in "
                         "practice thins lone routes (1.0 = raster behaviour)")

args = parser.parse_args()


def _parse_source(spec: str) -> tuple[Path, int, int]:
    path, _, zooms = spec.rpartition(":")
    if not path or "-" not in zooms:
        raise SystemExit(f"--source must look like PATH:ZMIN-ZMAX, got {spec!r}")
    lo, _, hi = zooms.partition("-")
    return (Path(path), int(lo), int(hi))


if args.source:
    if args.loom_geojson:
        raise SystemExit("Give either the positional line graph or --source, not both")
    sources = [_parse_source(s) for s in args.source]
elif args.loom_geojson:
    sources = [(args.loom_geojson, args.min_zoom, args.max_zoom)]
else:
    raise SystemExit("Need a line graph: positional argument or --source")

build(sources, args.output, args.attribution, args.solo_scale,
      args.stop_min_zoom, args.gtfs, args.sprite_table)
