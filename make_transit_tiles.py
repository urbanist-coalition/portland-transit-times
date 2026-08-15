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

import gzip
import json
import math
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from collections import defaultdict
from pathlib import Path

import mapbox_vector_tile
import mercantile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, MultiLineString, box
from shapely.ops import linemerge
from shapely.strtree import STRtree
from tqdm import tqdm

LAYER = "routes"
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


def build(loom_geojson: Path, out_path: Path, min_zoom: int, max_zoom: int,
          attribution: str, solo_scale: float):
    feats = load_edges(loom_geojson, solo_scale)
    if not feats:
        raise SystemExit(f"No usable line features in {loom_geojson}")
    geoms = [f["geom"] for f in feats]
    routes = {f["props"]["route_id"] for f in feats}
    print(f"Loaded {len(feats)} edge-line features across {len(routes)} routes "
          f"from {loom_geojson}")

    tree = STRtree(geoms)

    # Data bounds, mercator -> lon/lat, for the PMTiles header.
    minx = min(g.bounds[0] for g in geoms)
    miny = min(g.bounds[1] for g in geoms)
    maxx = max(g.bounds[2] for g in geoms)
    maxy = max(g.bounds[3] for g in geoms)
    west, south = _from_mercator(minx, miny)
    east, north = _from_mercator(maxx, maxy)
    print(f"Bounds: {west:.4f} {south:.4f} {east:.4f} {north:.4f}")

    tiles: dict[int, bytes] = {}
    for z in range(min_zoom, max_zoom + 1):
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
            if not layer_feats:
                continue

            # NB: these must go through `default_options`. Passing them as
            # bare kwargs hits a deprecated path that skips the y-axis flip,
            # producing tiles mirrored within each tile — which decodes
            # plausibly but renders wrong.
            encoded = mapbox_vector_tile.encode(
                [{"name": LAYER, "features": layer_feats}],
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
parser.add_argument("loom_geojson", type=Path, help="loom output (see run_loom.sh)")
parser.add_argument("output", type=Path, help="path to write the .pmtiles file")
parser.add_argument("--min-zoom", type=int, default=9)
parser.add_argument("--max-zoom", type=int, default=14,
                    help="MapLibre overzooms past this, so 14 still renders at z18")
parser.add_argument("--attribution", default="")
parser.add_argument("--solo-scale", type=float, default=0.5,
                    help="width multiplier ceiling for every line, which in "
                         "practice thins lone routes (1.0 = raster behaviour)")

args = parser.parse_args()
build(args.loom_geojson, args.output, args.min_zoom, args.max_zoom,
      args.attribution, args.solo_scale)
