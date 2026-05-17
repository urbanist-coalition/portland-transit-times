import asyncio
import os
import sys
from email.utils import formatdate, parsedate_to_datetime
from pathlib import Path
from argparse import ArgumentParser, RawDescriptionHelpFormatter

import httpx
from mercantile import Tile, tiles
from tqdm import tqdm
from tqdm.asyncio import tqdm as tqdm_asyncio

THEMES = {
    "positron":            "light_all",
    "positron-nolabels":   "light_nolabels",
    "darkmatter":          "dark_all",
    "darkmatter-nolabels": "dark_nolabels",
    "voyager":             "rastertiles/voyager",
}

MAX_CONCURRENCY = 40
MAX_ATTEMPTS = 4


async def fetch_tile(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    output_dir: Path,
    theme: str,
    tile: Tile,
) -> str | None:
    x, y, z = tile.x, tile.y, tile.z
    out_path = output_dir / str(z) / str(x) / f"{y}.png"
    url = f"https://a.basemaps.cartocdn.com/{theme}/{z}/{x}/{y}.png"

    # Revalidate existing tiles with If-Modified-Since against the local file's
    # mtime (set from the server's Last-Modified on the original download).
    # Server returns 304 with no body when nothing changed.
    headers: dict[str, str] = {}
    if out_path.exists():
        headers["If-Modified-Since"] = formatdate(out_path.stat().st_mtime, usegmt=True)

    async with sem:
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = await client.get(url, headers=headers)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                if attempt == MAX_ATTEMPTS - 1:
                    tqdm.write(f"FAILED {url}: {type(e).__name__}: {e or '(no message)'}", file=sys.stderr)
                    return "failed"
                await asyncio.sleep(2 ** attempt)
                continue

            if response.status_code == 304:
                return "unchanged"

            if response.status_code == 429 or response.status_code >= 500:
                if attempt == MAX_ATTEMPTS - 1:
                    tqdm.write(f"FAILED {url}: HTTP {response.status_code}", file=sys.stderr)
                    return "failed"
                delay = float(response.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(delay)
                continue

            if response.status_code >= 400:
                tqdm.write(f"FAILED {url}: HTTP {response.status_code}", file=sys.stderr)
                return "failed"

            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(response.content)
            # Stamp file with the server's Last-Modified so future runs can
            # revalidate. If the header is missing/malformed, leave mtime alone.
            last_mod = response.headers.get("Last-Modified")
            if last_mod:
                try:
                    ts = parsedate_to_datetime(last_mod).timestamp()
                    os.utime(out_path, (ts, ts))
                except (TypeError, ValueError):
                    pass
            return "ok"


async def download_tiles(
    output_dir: str,
    theme_name: str,
    bbox: list[float],
    min_zoom: int,
    max_zoom: int,
):
    theme = THEMES[theme_name]
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    t = list(tiles(*bbox, zooms=range(min_zoom, max_zoom + 1)))
    limits = httpx.Limits(max_connections=MAX_CONCURRENCY, max_keepalive_connections=MAX_CONCURRENCY)
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    async with httpx.AsyncClient(limits=limits, timeout=30.0) as client:
        results = await tqdm_asyncio.gather(
            *(fetch_tile(client, sem, out, theme, tile) for tile in t),
            desc="tiles",
            unit="tile",
            mininterval=2.0,
        )
    failed = sum(1 for r in results if r == "failed")
    unchanged = sum(1 for r in results if r == "unchanged")
    fresh = sum(1 for r in results if r == "ok")
    print(f"Done. {len(t)} tiles: {fresh} new/updated, {unchanged} unchanged, {failed} failed.", file=sys.stderr)


parser = ArgumentParser(
    description="Download Carto basemap raster tiles for a bounding box and "
                "zoom range. Tiles are written to OUTPUT_DIR in the standard "
                "slippy-map layout: {z}/{x}/{y}.png. Existing files are "
                "skipped, so re-runs resume cheaply.",
    epilog="Example:\n"
           "  python download.py ./out positron\n"
           "  python download.py ./out voyager --bbox -70.35 43.55 -70.15 43.75 --min-zoom 10 --max-zoom 16",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument(
    "output_dir",
    help="directory to write tiles into (created if missing)",
)
parser.add_argument(
    "theme_name",
    choices=sorted(THEMES),
    metavar="theme_name",
    help="Carto basemap style. One of: " + ", ".join(sorted(THEMES)),
)
parser.add_argument(
    "--bbox",
    nargs=4,
    type=float,
    metavar=("WEST", "SOUTH", "EAST", "NORTH"),
    default=[-70.85, 43.34, -69.71, 44.10],
    help="bounding box as four floats (default: Portland, ME area)",
)
parser.add_argument(
    "--min-zoom",
    type=int,
    default=10,
    help="lowest zoom level to fetch (default: 10)",
)
parser.add_argument(
    "--max-zoom",
    type=int,
    default=16,
    help="highest zoom level to fetch, inclusive (default: 16)",
)

args = parser.parse_args()
asyncio.run(download_tiles(args.output_dir, args.theme_name, args.bbox, args.min_zoom, args.max_zoom))
