import csv
import io
import json
import math
import multiprocessing
import shutil
import zipfile
from collections import defaultdict
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from dataclasses import dataclass, field
from pathlib import Path

import cairocffi as cairo
import mercantile
from shapely.affinity import translate
from shapely.geometry import LineString, box
from shapely.strtree import STRtree
from tqdm import tqdm

DEFAULT_RGB = (255, 107, 53)  # #FF6B35
TILE_SIZE = 256
ALPHA = 0.75  # lets basemap & crossings show through


@dataclass
class Route:
    route_id: str
    short_name: str
    long_name: str
    color: str  # hex without "#", or "" if unset in GTFS
    shapes: list[list[tuple[float, float]]] = field(default_factory=list)
    # Parallel to `shapes`: (index_in_bundle, bundle_size) for that shape's edge.
    # Lets us offset the route perpendicular to the edge centerline when
    # several routes share the same edge (loom output). For raw GTFS, every
    # shape is (0, 1) — no offset applied.
    offsets: list[tuple[int, int]] = field(default_factory=list)


def load_routes(source: Path) -> list[Route]:
    """Load routes from a GTFS feed (zip or directory) or a loom GeoJSON file."""
    if source.suffix.lower() in (".geojson", ".json"):
        return _load_loom(source)
    return _load_gtfs(source)


def _load_gtfs(gtfs: Path) -> list[Route]:
    if gtfs.is_dir():
        def opener(name):
            return open(gtfs / name, newline="", encoding="utf-8-sig")
        return _load(opener)
    with zipfile.ZipFile(gtfs) as zf:
        def opener(name):
            return io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", newline="")
        return _load(opener)


def _load_loom(geojson_path: Path) -> list[Route]:
    """Load routes from a loom-produced GeoJSON line graph.

    Each feature is an edge of the line graph; its `lines` property lists
    routes sharing the edge (with id, color, label), in loom's optimal
    ordering. We record each line's position within that bundle so the
    renderer can offset it perpendicular to the edge centerline.
    """
    with open(geojson_path) as f:
        data = json.load(f)
    routes_by_id: dict[str, Route] = {}
    for feature in data.get("features", []):
        geom = feature.get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates", [])
        if len(coords) < 2:
            continue
        shape = [(lat, lon) for lon, lat in coords]  # GeoJSON is (lon, lat)
        lines = (feature.get("properties") or {}).get("lines", [])
        bundle_size = len(lines)
        for offset_idx, line in enumerate(lines):
            rid = line.get("id") or ""
            if not rid:
                continue
            if rid not in routes_by_id:
                routes_by_id[rid] = Route(
                    route_id=rid,
                    short_name=line.get("label", "") or "",
                    long_name="",
                    color=line.get("color", "") or "",
                )
            routes_by_id[rid].shapes.append(shape)
            routes_by_id[rid].offsets.append((offset_idx, bundle_size))
    return list(routes_by_id.values())


def _load(opener) -> list[Route]:
    routes_by_id: dict[str, Route] = {}
    with opener("routes.txt") as f:
        for row in csv.DictReader(f):
            rid = row["route_id"]
            routes_by_id[rid] = Route(
                route_id=rid,
                short_name=row.get("route_short_name", "") or "",
                long_name=row.get("route_long_name", "") or "",
                color=row.get("route_color", "") or "",
            )

    route_shape_pairs: set[tuple[str, str]] = set()
    with opener("trips.txt") as f:
        for row in csv.DictReader(f):
            shape_id = row.get("shape_id", "")
            if shape_id:
                route_shape_pairs.add((row["route_id"], shape_id))

    raw_pts: dict[str, list[tuple[int, float, float]]] = {}
    with opener("shapes.txt") as f:
        for row in csv.DictReader(f):
            raw_pts.setdefault(row["shape_id"], []).append((
                int(row["shape_pt_sequence"]),
                float(row["shape_pt_lat"]),
                float(row["shape_pt_lon"]),
            ))
    shapes = {
        sid: [(lat, lon) for _, lat, lon in sorted(pts)]
        for sid, pts in raw_pts.items()
    }

    for route_id, shape_id in route_shape_pairs:
        if route_id in routes_by_id and shape_id in shapes:
            routes_by_id[route_id].shapes.append(shapes[shape_id])
            routes_by_id[route_id].offsets.append((0, 1))

    return list(routes_by_id.values())


def lonlat_to_tile_px(lon: float, lat: float, z: int, tile_x: int, tile_y: int) -> tuple[float, float]:
    n = 2 ** z
    gx = (lon + 180.0) / 360.0 * n * TILE_SIZE
    lat_rad = math.radians(lat)
    gy = (1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n * TILE_SIZE
    return (gx - tile_x * TILE_SIZE, gy - tile_y * TILE_SIZE)


def _project_to_global_pixel(line: LineString, z: int) -> LineString:
    n = 2 ** z
    coords = []
    for lon, lat in line.coords:
        gx = (lon + 180.0) / 360.0 * n * TILE_SIZE
        lat_rad = math.radians(lat)
        gy = (1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n * TILE_SIZE
        coords.append((gx, gy))
    return LineString(coords)


def _parse_color(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
        return DEFAULT_RGB
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


_WORKER: dict = {}


def _init_worker(offset_lines_by_zoom, widths_by_zoom, fills, tree, input_dir, output_dir):
    _WORKER["offset_lines_by_zoom"] = offset_lines_by_zoom
    _WORKER["widths_by_zoom"] = widths_by_zoom
    _WORKER["fills"] = fills
    _WORKER["tree"] = tree
    _WORKER["input_dir"] = input_dir
    _WORKER["output_dir"] = output_dir


def _draw_pixel_geom(ctx: cairo.Context, geom):
    if geom.is_empty:
        return
    if geom.geom_type == "LineString":
        coords = list(geom.coords)
        if len(coords) < 2:
            return
        ctx.move_to(*coords[0])
        for c in coords[1:]:
            ctx.line_to(*c)
    elif geom.geom_type in ("MultiLineString", "GeometryCollection"):
        for sub in geom.geoms:
            _draw_pixel_geom(ctx, sub)


def _process_tile(zxy: tuple[int, int, int]):
    z, x, y = zxy
    input_path = _WORKER["input_dir"] / str(z) / str(x) / f"{y}.png"
    output_path = _WORKER["output_dir"] / str(z) / str(x) / f"{y}.png"

    if output_path.exists():
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)

    line_width = max(1, z - 8)
    buffer_px = line_width + 2

    # Tile bbox in global pixel space at zoom z. Buffer outward so round line
    # caps land outside the canvas (Cairo clips them) — boundary pixels are
    # stroke body, identical in adjacent tiles.
    gx0 = x * TILE_SIZE
    gy0 = y * TILE_SIZE
    pixel_clip = box(
        gx0 - buffer_px,
        gy0 - buffer_px,
        gx0 + TILE_SIZE + buffer_px,
        gy0 + TILE_SIZE + buffer_px,
    )

    # Query the lon/lat STRtree, buffered enough in degrees to catch lines
    # whose offset-shifted bbox might enter this tile even though the original
    # bbox doesn't quite.
    b = mercantile.bounds(x, y, z)
    deg_per_px = 360.0 / (2 ** z * TILE_SIZE)
    query_buf_deg = buffer_px * 4 * deg_per_px  # generous, cheap
    query_box = box(
        b.west - query_buf_deg,
        b.south - query_buf_deg,
        b.east + query_buf_deg,
        b.north + query_buf_deg,
    )
    indices = _WORKER["tree"].query(query_box)
    if len(indices) == 0:
        shutil.copy(input_path, output_path)
        return

    zoom_offset_lines = _WORKER["offset_lines_by_zoom"][z]

    pixel_items: list[tuple[int, object]] = []
    for i in indices:
        idx = int(i)
        clipped = zoom_offset_lines[idx].intersection(pixel_clip)
        if clipped.is_empty:
            continue
        pixel_items.append((idx, translate(clipped, xoff=-gx0, yoff=-gy0)))

    if not pixel_items:
        shutil.copy(input_path, output_path)
        return

    zoom_widths = _WORKER["widths_by_zoom"][z]

    surface = cairo.ImageSurface.create_from_png(str(input_path))
    ctx = cairo.Context(surface)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)

    # Group items by fill (= by route). Draw each route's strokes opaquely
    # onto its own group surface, then composite with the route alpha so
    # round line caps overlapping themselves at internal nodes don't create
    # darker spots (the "joint darkening" artifact).
    by_fill: dict[tuple, list[tuple[int, object]]] = defaultdict(list)
    for idx, geom in pixel_items:
        by_fill[_WORKER["fills"][idx]].append((idx, geom))

    for (r, g, b, a), items in by_fill.items():
        ctx.push_group()
        ctx.set_source_rgba(r / 255, g / 255, b / 255, 1.0)
        for idx, geom in items:
            ctx.set_line_width(zoom_widths[idx])
            _draw_pixel_geom(ctx, geom)
            ctx.stroke()
        ctx.pop_group_to_source()
        ctx.paint_with_alpha(a)

    surface.write_to_png(str(output_path))


def draw_routes(input_dir: Path, output_dir: Path, gtfs: Path):
    routes = load_routes(gtfs)
    n_shapes = sum(len(r.shapes) for r in routes)
    n_points = sum(len(s) for r in routes for s in r.shapes)
    print(f"Loaded {len(routes)} routes, {n_shapes} shapes, {n_points} shape points from {gtfs}")

    lines: list[LineString] = []
    fills: list[tuple[int, int, int, float]] = []
    offsets: list[tuple[int, int]] = []
    for route in routes:
        fill = (*_parse_color(route.color), ALPHA)
        for j, shape in enumerate(route.shapes):
            if len(shape) < 2:
                continue
            lines.append(LineString([(lon, lat) for lat, lon in shape]))
            fills.append(fill)
            offsets.append(route.offsets[j] if j < len(route.offsets) else (0, 1))
    print(f"Building spatial index over {len(lines)} polylines")
    tree = STRtree(lines)

    output_dir.mkdir(parents=True, exist_ok=True)
    tasks: list[tuple[int, int, int]] = []
    zooms_seen: set[int] = set()
    for png_path in input_dir.glob("*/*/*.png"):
        try:
            z = int(png_path.parent.parent.name)
            x = int(png_path.parent.name)
            y = int(png_path.stem)
        except ValueError:
            continue
        tasks.append((z, x, y))
        zooms_seen.add(z)
    print(f"Processing {len(tasks)} tiles across zooms {sorted(zooms_seen)}")

    # Pre-simplify per zoom (in lon/lat) then project to global pixel space
    # and apply per-edge offsets ONCE per zoom. Computing offsets globally
    # ensures every tile sees the same offset geometry, so the offset can't
    # disagree at tile boundaries. Per-line width formula: the total corridor
    # widens from 1x (single route) up to 2x base (two or more routes), then
    # the lines split that budget evenly — so a triple is 2/3 base each, a
    # quadruple is 1/2 base each, etc.
    offset_lines_by_zoom: dict[int, list[LineString]] = {}
    widths_by_zoom: dict[int, list[float]] = {}
    for z in zooms_seen:
        base_width = max(1, z - 8)
        tol = 360.0 / (2 ** z * TILE_SIZE) * 1.5
        layer_lines: list[LineString] = []
        layer_widths: list[float] = []
        for i, ln in enumerate(lines):
            simplified = ln.simplify(tol, preserve_topology=False)
            pixel_line = _project_to_global_pixel(simplified, z)
            offset_idx, bundle_size = offsets[i]
            line_w = max(1.0, base_width * min(bundle_size, 2) / bundle_size)
            if bundle_size > 1:
                # Spacing == per-line width: lines touch edge-to-edge in bundle.
                signed = (offset_idx - (bundle_size - 1) / 2) * line_w
                if abs(signed) > 0.01:
                    candidate = pixel_line.offset_curve(signed)
                    if not candidate.is_empty:
                        pixel_line = candidate
            layer_lines.append(pixel_line)
            layer_widths.append(line_w)
        offset_lines_by_zoom[z] = layer_lines
        widths_by_zoom[z] = layer_widths

    with multiprocessing.Pool(
        initializer=_init_worker,
        initargs=(offset_lines_by_zoom, widths_by_zoom, fills, tree, input_dir, output_dir),
    ) as pool:
        for _ in tqdm(
            pool.imap_unordered(_process_tile, tasks, chunksize=16),
            total=len(tasks),
            unit="tile",
            mininterval=2.0,
        ):
            pass


parser = ArgumentParser(
    description="Draw GTFS routes on top of a downloaded basemap tile pyramid. "
                "Reads tiles from INPUT_DIR (the layout produced by download.py: "
                "{z}/{x}/{y}.png), composites route geometry from GTFS onto each "
                "tile, and writes the result to OUTPUT_DIR using the same layout. "
                "GTFS may be a raw feed (.zip or extracted directory) or a "
                "loom-produced GeoJSON line graph (.geojson/.json) for "
                "deduplicated, topology-aware route geometry — see run_loom.sh.",
    epilog="Example:\n"
           "  python draw_routes.py ./out ./out-with-routes ./gtfs.zip\n"
           "  python draw_routes.py ./out ./out-with-routes ./gtfs/\n"
           "  python draw_routes.py ./out ./out-with-routes ./loom.geojson",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument(
    "input_dir",
    type=Path,
    help="directory of basemap tiles in {z}/{x}/{y}.png layout (from download.py)",
)
parser.add_argument(
    "output_dir",
    type=Path,
    help="directory to write the route-overlaid tiles into (created if missing)",
)
parser.add_argument(
    "gtfs",
    type=Path,
    help="path to a GTFS feed (zip or directory) or a loom GeoJSON file "
         "(.geojson / .json — auto-detected by extension)",
)

args = parser.parse_args()
draw_routes(args.input_dir, args.output_dir, args.gtfs)
