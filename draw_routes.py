import csv
import io
import math
import multiprocessing
import shutil
import zipfile
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from dataclasses import dataclass, field
from pathlib import Path

import cairocffi as cairo
import mercantile
from shapely.geometry import LineString, box
from shapely.strtree import STRtree
from tqdm import tqdm

DEFAULT_RGB = (255, 107, 53)  # #FF6B35
TILE_SIZE = 256
TOO_LIGHT_THRESHOLD = 0.8
NORMAL_ALPHA = 0.5  # matches the React app's opacity for non-light routes
LIGHT_ALPHA = 1.0   # too-light routes draw fully opaque, with a black halo behind them


@dataclass
class Route:
    route_id: str
    short_name: str
    long_name: str
    color: str  # hex without "#", or "" if unset in GTFS
    shapes: list[list[tuple[float, float]]] = field(default_factory=list)


def load_routes(gtfs: Path) -> list[Route]:
    if gtfs.is_dir():
        def opener(name):
            return open(gtfs / name, newline="", encoding="utf-8-sig")
        return _load(opener)
    with zipfile.ZipFile(gtfs) as zf:
        def opener(name):
            return io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", newline="")
        return _load(opener)


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

    return list(routes_by_id.values())


def lonlat_to_tile_px(lon: float, lat: float, z: int, tile_x: int, tile_y: int) -> tuple[float, float]:
    n = 2 ** z
    gx = (lon + 180.0) / 360.0 * n * TILE_SIZE
    lat_rad = math.radians(lat)
    gy = (1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n * TILE_SIZE
    return (gx - tile_x * TILE_SIZE, gy - tile_y * TILE_SIZE)


def _parse_color(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
        return DEFAULT_RGB
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _is_too_light(rgb: tuple[int, int, int], threshold: float = TOO_LIGHT_THRESHOLD) -> bool:
    def channel_lum(c_byte: int) -> float:
        c = c_byte / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    rel_lum = 0.2126 * channel_lum(r) + 0.7152 * channel_lum(g) + 0.0722 * channel_lum(b)
    return rel_lum > threshold


_WORKER: dict = {}


def _init_worker(lines_by_zoom, fills, needs_outline, tree, input_dir, output_dir):
    _WORKER["lines_by_zoom"] = lines_by_zoom
    _WORKER["fills"] = fills
    _WORKER["needs_outline"] = needs_outline
    _WORKER["tree"] = tree
    _WORKER["input_dir"] = input_dir
    _WORKER["output_dir"] = output_dir


def _build_path(ctx: cairo.Context, geom, z: int, tile_x: int, tile_y: int):
    if geom.is_empty:
        return
    if geom.geom_type == "LineString":
        coords = list(geom.coords)
        if len(coords) < 2:
            return
        lon, lat = coords[0]
        px, py = lonlat_to_tile_px(lon, lat, z, tile_x, tile_y)
        ctx.move_to(px, py)
        for lon, lat in coords[1:]:
            px, py = lonlat_to_tile_px(lon, lat, z, tile_x, tile_y)
            ctx.line_to(px, py)
    elif geom.geom_type in ("MultiLineString", "GeometryCollection"):
        for sub in geom.geoms:
            _build_path(ctx, sub, z, tile_x, tile_y)


def _process_tile(zxy: tuple[int, int, int]):
    z, x, y = zxy
    input_path = _WORKER["input_dir"] / str(z) / str(x) / f"{y}.png"
    output_path = _WORKER["output_dir"] / str(z) / str(x) / f"{y}.png"

    if output_path.exists():
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)

    b = mercantile.bounds(x, y, z)
    tile_box = box(b.west, b.south, b.east, b.north)

    indices = _WORKER["tree"].query(tile_box)
    if len(indices) == 0:
        shutil.copy(input_path, output_path)
        return

    # Use the pre-simplified lines for this zoom so adjacent tiles agree on
    # the line's vertices and we don't get angle disagreements at boundaries.
    zoom_lines = _WORKER["lines_by_zoom"][z]

    # Buffer the clip box outward so lines extend past the tile edge. Cairo's
    # round line caps then land OUTSIDE the canvas (clipped away on render),
    # and what crosses the boundary is just stroke body — identical in
    # adjacent tiles, no notch at the seam.
    line_width = max(1, z - 8)
    buffer_px = line_width + 2
    buffer_deg = buffer_px * 360.0 / (2 ** z * TILE_SIZE)
    clip_box = box(
        b.west - buffer_deg,
        b.south - buffer_deg,
        b.east + buffer_deg,
        b.north + buffer_deg,
    )

    clipped_items: list[tuple[int, object]] = []
    for i in indices:
        idx = int(i)
        clipped = zoom_lines[idx].intersection(clip_box)
        if not clipped.is_empty:
            clipped_items.append((idx, clipped))

    if not clipped_items:
        shutil.copy(input_path, output_path)
        return

    outline_width = line_width + 1

    surface = cairo.ImageSurface.create_from_png(str(input_path))
    ctx = cairo.Context(surface)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)

    # Pass 1: black halos behind too-light routes
    ctx.set_source_rgba(0, 0, 0, 1.0)
    ctx.set_line_width(outline_width)
    for idx, clipped in clipped_items:
        if not _WORKER["needs_outline"][idx]:
            continue
        _build_path(ctx, clipped, z, x, y)
        ctx.stroke()

    # Pass 2: route colors on top
    ctx.set_line_width(line_width)
    for idx, clipped in clipped_items:
        r, g, b, a = _WORKER["fills"][idx]
        ctx.set_source_rgba(r / 255, g / 255, b / 255, a)
        _build_path(ctx, clipped, z, x, y)
        ctx.stroke()

    surface.write_to_png(str(output_path))


def draw_routes(input_dir: Path, output_dir: Path, gtfs: Path):
    routes = load_routes(gtfs)
    n_shapes = sum(len(r.shapes) for r in routes)
    n_points = sum(len(s) for r in routes for s in r.shapes)
    print(f"Loaded {len(routes)} routes, {n_shapes} shapes, {n_points} shape points from {gtfs}")

    lines: list[LineString] = []
    fills: list[tuple[int, int, int, float]] = []
    needs_outline: list[bool] = []
    for route in routes:
        rgb = _parse_color(route.color)
        too_light = _is_too_light(rgb)
        alpha = LIGHT_ALPHA if too_light else NORMAL_ALPHA
        fill = (*rgb, alpha)
        for shape in route.shapes:
            if len(shape) < 2:
                continue
            lines.append(LineString([(lon, lat) for lat, lon in shape]))
            fills.append(fill)
            needs_outline.append(too_light)
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

    # Pre-simplify per zoom so all tiles agree on the same vertex set
    # (multiplier of 1.5 px matches the previous per-tile setting).
    lines_by_zoom: dict[int, list[LineString]] = {}
    for z in zooms_seen:
        tol = 360.0 / (2 ** z * TILE_SIZE) * 1.5
        lines_by_zoom[z] = [line.simplify(tol, preserve_topology=False) for line in lines]

    with multiprocessing.Pool(
        initializer=_init_worker,
        initargs=(lines_by_zoom, fills, needs_outline, tree, input_dir, output_dir),
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
                "{z}/{x}/{y}.png), composites route geometry from GTFS_PATH onto "
                "each tile, and writes the result to OUTPUT_DIR using the same "
                "layout.",
    epilog="Example:\n"
           "  python draw_routes.py ./out ./out-with-routes ./gtfs.zip\n"
           "  python draw_routes.py ./out ./out-with-routes ./gtfs/",
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
    help="path to a GTFS feed (zip file or extracted directory)",
)

args = parser.parse_args()
draw_routes(args.input_dir, args.output_dir, args.gtfs)
