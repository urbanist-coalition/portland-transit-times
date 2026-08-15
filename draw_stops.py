import csv
import io
import math
import multiprocessing
import shutil
import zipfile
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from collections import defaultdict
from pathlib import Path

import cairocffi as cairo
import mercantile
from shapely.geometry import Point, box
from shapely.strtree import STRtree
from tqdm import tqdm

TILE_SIZE = 256
MIN_STOP_ZOOM = 15

# Mirrors the React app's zoomIconSizes table.
ICON_SIZES = {
    15: 14, 16: 16, 17: 18, 18: 20, 19: 22, 20: 24,
}
ICON_SIZE_DEFAULT = 14

DEFAULT_RGB = (255, 107, 53)
OUTLINE_RGB = (97, 97, 97)  # MUI grey[700], matches the React StopIcon outline


def _parse_color(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
        return DEFAULT_RGB
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def load_stops(gtfs: Path) -> list[tuple[float, float, list[tuple[int, int, int]]]]:
    """Return (lat, lon, [rgb,...]) per stop served by at least one route."""
    if gtfs.is_dir():
        def opener(name):
            return open(gtfs / name, newline="", encoding="utf-8-sig")
        return _load(opener)
    with zipfile.ZipFile(gtfs) as zf:
        def opener(name):
            return io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", newline="")
        return _load(opener)


def _load(opener) -> list[tuple[float, float, list[tuple[int, int, int]]]]:
    route_info: dict[str, tuple[str, tuple[int, int, int]]] = {}
    with opener("routes.txt") as f:
        for row in csv.DictReader(f):
            route_info[row["route_id"]] = (
                row.get("route_short_name", "") or "",
                _parse_color(row.get("route_color", "")),
            )

    trip_to_route: dict[str, str] = {}
    with opener("trips.txt") as f:
        for row in csv.DictReader(f):
            trip_to_route[row["trip_id"]] = row["route_id"]

    stop_loc: dict[str, tuple[float, float]] = {}
    with opener("stops.txt") as f:
        for row in csv.DictReader(f):
            try:
                stop_loc[row["stop_id"]] = (
                    float(row["stop_lat"]),
                    float(row["stop_lon"]),
                )
            except (KeyError, ValueError):
                continue

    stop_routes: dict[str, set[str]] = defaultdict(set)
    with opener("stop_times.txt") as f:
        for row in csv.DictReader(f):
            rid = trip_to_route.get(row.get("trip_id", ""))
            if rid:
                stop_routes[row["stop_id"]].add(rid)

    out = []
    for stop_id, (lat, lon) in stop_loc.items():
        rids = stop_routes.get(stop_id)
        if not rids:
            continue
        # Stable visual: sort by route_short_name so the same set of routes
        # always produces the same slice arrangement.
        sorted_rids = sorted(rids, key=lambda r: route_info.get(r, ("", DEFAULT_RGB))[0])
        rgbs = [route_info[r][1] for r in sorted_rids if r in route_info]
        if rgbs:
            out.append((lat, lon, rgbs))
    return out


def lonlat_to_global_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    gx = (lon + 180.0) / 360.0 * n * TILE_SIZE
    lat_rad = math.radians(lat)
    gy = (1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n * TILE_SIZE
    return (gx, gy)


def _draw_pie(ctx: cairo.Context, cx: float, cy: float, size: float, rgbs):
    outline_w = max(1.0, size / 14.0)
    radius = size / 2.0 - outline_w / 2.0

    if len(rgbs) == 1:
        r, g, b = rgbs[0]
        ctx.set_source_rgb(r / 255, g / 255, b / 255)
        ctx.arc(cx, cy, radius, 0, 2 * math.pi)
        ctx.fill()
    else:
        n = len(rgbs)
        for i, (r, g, b) in enumerate(rgbs):
            start = (i - 0.5) / n * 2 * math.pi
            end = (i + 0.5) / n * 2 * math.pi
            ctx.set_source_rgb(r / 255, g / 255, b / 255)
            ctx.move_to(cx, cy)
            ctx.arc(cx, cy, radius, start, end)
            ctx.close_path()
            ctx.fill()

    r, g, b = OUTLINE_RGB
    ctx.set_source_rgb(r / 255, g / 255, b / 255)
    ctx.set_line_width(outline_w)
    ctx.arc(cx, cy, radius, 0, 2 * math.pi)
    ctx.stroke()


_WORKER: dict = {}


def _init_worker(stops, tree, input_dir, output_dir):
    _WORKER["stops"] = stops
    _WORKER["tree"] = tree
    _WORKER["input_dir"] = input_dir
    _WORKER["output_dir"] = output_dir


def _process_tile(zxy: tuple[int, int, int]):
    z, x, y = zxy
    input_path = _WORKER["input_dir"] / str(z) / str(x) / f"{y}.png"
    output_path = _WORKER["output_dir"] / str(z) / str(x) / f"{y}.png"

    if output_path.exists():
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Below the threshold: pass the tile through unchanged.
    if z < MIN_STOP_ZOOM:
        shutil.copy(input_path, output_path)
        return

    icon_size = ICON_SIZES.get(z, ICON_SIZE_DEFAULT)
    half_icon = icon_size / 2 + 1  # +1 for outline overhang

    b = mercantile.bounds(x, y, z)
    deg_per_px = 360.0 / (2 ** z * TILE_SIZE)
    buf_deg = half_icon * deg_per_px
    query_box = box(
        b.west - buf_deg,
        b.south - buf_deg,
        b.east + buf_deg,
        b.north + buf_deg,
    )
    indices = _WORKER["tree"].query(query_box)
    if len(indices) == 0:
        shutil.copy(input_path, output_path)
        return

    gx0 = x * TILE_SIZE
    gy0 = y * TILE_SIZE
    to_draw: list[tuple[float, float, list[tuple[int, int, int]]]] = []
    for i in indices:
        idx = int(i)
        lat, lon, rgbs = _WORKER["stops"][idx]
        gx, gy = lonlat_to_global_pixel(lon, lat, z)
        lx, ly = gx - gx0, gy - gy0
        if lx + half_icon < 0 or lx - half_icon > TILE_SIZE:
            continue
        if ly + half_icon < 0 or ly - half_icon > TILE_SIZE:
            continue
        to_draw.append((lx, ly, rgbs))

    if not to_draw:
        shutil.copy(input_path, output_path)
        return

    surface = cairo.ImageSurface.create_from_png(str(input_path))
    ctx = cairo.Context(surface)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    for lx, ly, rgbs in to_draw:
        _draw_pie(ctx, lx, ly, icon_size, rgbs)
    surface.write_to_png(str(output_path))


def draw_stops(input_dir: Path, output_dir: Path, gtfs: Path):
    stops = load_stops(gtfs)
    print(f"Loaded {len(stops)} stops with route service from {gtfs}")

    points = [Point(lon, lat) for lat, lon, _ in stops]
    tree = STRtree(points)

    output_dir.mkdir(parents=True, exist_ok=True)
    tasks: list[tuple[int, int, int]] = []
    for png_path in input_dir.glob("*/*/*.png"):
        try:
            z = int(png_path.parent.parent.name)
            x = int(png_path.parent.name)
            y = int(png_path.stem)
        except ValueError:
            continue
        tasks.append((z, x, y))
    print(f"Processing {len(tasks)} tiles")

    with multiprocessing.Pool(
        initializer=_init_worker,
        initargs=(stops, tree, input_dir, output_dir),
    ) as pool:
        for _ in tqdm(
            pool.imap_unordered(_process_tile, tasks, chunksize=16),
            total=len(tasks),
            unit="tile",
            mininterval=2.0,
        ):
            pass


parser = ArgumentParser(
    description="Draw GTFS pie-slice stops on top of an existing tile pyramid. "
                "For each stop at zoom >= 15, renders a circle divided into "
                "slices colored by the routes that serve it. Outputs the same "
                "{z}/{x}/{y}.png layout, suitable for chaining after "
                "draw_routes.py.",
    epilog="Example:\n"
           "  python draw_stops.py ./out/routes-loom ./out/stops ./gtfs.zip",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument(
    "input_dir",
    type=Path,
    help="tile pyramid to draw onto (e.g. the output of draw_routes.py)",
)
parser.add_argument(
    "output_dir",
    type=Path,
    help="directory to write the stop-overlaid tiles into (created if missing)",
)
parser.add_argument(
    "gtfs",
    type=Path,
    help="path to a GTFS feed (zip or extracted directory)",
)

args = parser.parse_args()
draw_stops(args.input_dir, args.output_dir, args.gtfs)
