"""Build a fully self-hosted MapLibre style bundle from CARTO's Voyager style.

CARTO's Voyager style is open source (BSD-3 for the code, CC-BY 4.0 for the
design), but CARTO's *tile service* is enterprise-only. Happily the style is
written against the OpenMapTiles schema — the same schema planetiler emits — so
the style renders unmodified against our own basemap once the URLs are
repointed. Four things tether the stock style to CARTO's CDN, and this script
cuts all of them:

  sources   -> pmtiles://./basemap.pmtiles  (planetiler, from OSM)
  glyphs    -> ./fonts/{fontstack}/{range}.pbf
  sprite    -> ./sprite
  text-font -> rewritten to fonts we actually host

That last one needs explaining. Every fontstack in Voyager is five deep, e.g.

    Montserrat Medium, Open Sans Bold, Noto Sans Regular,
    HanWangHeiLight Regular, NanumBarunGothic Regular

MapLibre requests the whole comma-joined stack as a single URL path, and a
static file server cannot compose one on the fly — it can only serve stacks
that exist on disk. Rather than invent typography, we collapse each stack to
CARTO's *own* declared second choice, Open Sans, which openmaptiles/fonts
publishes as prebuilt glyph ranges. Labels come out in Open Sans instead of
Montserrat; everything else about the design is untouched.

The transit layers go in above roads, buildings and boundaries but beneath
every label, and do their line bundling with a data-driven `line-offset` —
see make_transit_tiles.py for where those attributes come from.
"""

import json
import shutil
import zipfile
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from pathlib import Path

import cairocffi as cairo

# Attribution is not optional here: ODbL for the OSM data, CC-BY for the
# OpenMapTiles schema, CC-BY 4.0 for the CARTO design.
ATTRIBUTION = (
    '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a> '
    '<a href="https://openmaptiles.org/">&copy; OpenMapTiles</a> '
    '<a href="https://carto.com/">&copy; CARTO</a>'
)

# Base stroke width per zoom, matching the raster renderer's max(1, z - 8).
WIDTH_STOPS = [(9, 1), (10, 2), (14, 6), (18, 10)]


def _zoom_interp(*factors: list) -> list:
    """interpolate(zoom) whose stop *values* are data-driven.

    The composition order matters and is not interchangeable: a ["zoom"]
    expression is only legal as the input to a *top-level* step/interpolate.
    Writing the intuitive ["*", interpolate(zoom, ...), ["get", ...]] instead
    nests zoom inside a multiply, which MapLibre rejects at parse time — and it
    rejects the entire style, not just the offending layer, so the basemap
    silently disappears along with it.
    """
    expr: list = ["interpolate", ["linear"], ["zoom"]]
    for zoom, width in WIDTH_STOPS:
        expr += [zoom, ["*", width, *factors]]
    return expr


# Per-feature width: the corridor budget split across the bundle.
LINE_WIDTH = _zoom_interp(["get", "wfactor"])
# Screen-space offset: signed slot in the bundle, times that width.
LINE_OFFSET = _zoom_interp(["get", "wfactor"], ["get", "offset"])


_INTERP_OPS = ("interpolate", "interpolate-hcl", "interpolate-lab", "step")


def _bad_zoom_uses(expr, top: bool = True) -> list:
    """Find ["zoom"] used anywhere MapLibre will reject it.

    MapLibre fails the *whole style* on this, not the one layer, so a single
    bad expression blanks the entire map. Cheap to check, expensive to debug
    by eye — the symptom is an empty page and a style that looks fine.
    """
    if not isinstance(expr, list) or not expr:
        return []
    if expr == ["zoom"]:
        return [] if top else [expr]
    op = expr[0]
    bad: list = []
    if op in _INTERP_OPS:
        idx = 1 if op == "step" else 2
        head, tail = expr[idx:idx + 1], expr[idx + 1:]
        for operand in head:
            # The input slot of a *top-level* interpolate/step may be ["zoom"].
            bad += [] if (top and operand == ["zoom"]) else _bad_zoom_uses(operand, False)
        for sub in tail:
            bad += _bad_zoom_uses(sub, False)
        return bad
    for sub in expr[1:]:
        bad += _bad_zoom_uses(sub, False)
    return bad


def validate(style: dict):
    problems = []
    for layer in style["layers"]:
        for section in ("paint", "layout"):
            for prop, value in (layer.get(section) or {}).items():
                for bad in _bad_zoom_uses(value):
                    problems.append(f"{layer['id']}.{section}.{prop}: nested {bad}")
    if problems:
        raise SystemExit("Invalid zoom expressions:\n  " + "\n  ".join(problems))
    print(f"Validated {len(style['layers'])} layers: no illegally nested zoom expressions")


def _resolve_fontstack(stack: list[str]) -> list[str]:
    """Collapse a Voyager fontstack to a single font we self-host."""
    if "Open Sans Bold" in stack:
        return ["Open Sans Bold"]
    if "Open Sans Italic" in stack:
        return ["Open Sans Italic"]
    return ["Open Sans Regular"]


def _transit_layers() -> list[dict]:
    return [
        {
            "id": "transit-routes",
            "type": "line",
            "source": "transit",
            "source-layer": "routes",
            "minzoom": 9,
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {
                "line-color": ["get", "color"],
                "line-width": LINE_WIDTH,
                "line-offset": LINE_OFFSET,
                # Deliberately opaque. The raster renderer drew routes at 0.75
                # because it composited them onto a basemap PNG that already
                # had labels baked in — translucency was the only way to keep
                # street names readable underneath. Here the transit layers sit
                # below every symbol layer, so labels draw on top and the
                # workaround is unnecessary. Opacity 1 also makes the
                # double-blend at overlapping geometry structurally impossible.
            },
        },
        {
            # Route numbers along the line. Symbol layers have no perpendicular
            # offset, so on shared corridors a label sits on the bundle's
            # centreline rather than on its own line — fine at these sizes,
            # but it is why this only switches on once lines are far apart.
            "id": "transit-route-labels",
            "type": "symbol",
            "source": "transit",
            "source-layer": "routes",
            "minzoom": 13,
            "layout": {
                "symbol-placement": "line",
                "text-field": ["get", "label"],
                "text-font": ["Open Sans Bold"],
                "text-size": 11,
                "symbol-spacing": 300,
                "text-max-angle": 40,
            },
            "paint": {
                "text-color": ["get", "color"],
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
            },
        },
    ]


def build_style(src: Path, out: Path, basemap: str, transit: str) -> set[str]:
    style = json.loads(src.read_text())

    style["sources"] = {
        "carto": {  # keep the name: all 93 stock layers reference it
            "type": "vector",
            "url": f"pmtiles://{basemap}",
            "attribution": ATTRIBUTION,
        },
        "transit": {
            "type": "vector",
            "url": f"pmtiles://{transit}",
        },
    }
    style["glyphs"] = "./fonts/{fontstack}/{range}.pbf"
    style["sprite"] = "./sprite"

    fonts_used: set[str] = set()
    for layer in style["layers"]:
        layout = layer.get("layout") or {}
        stack = layout.get("text-font")
        if isinstance(stack, list) and all(isinstance(s, str) for s in stack):
            resolved = _resolve_fontstack(stack)
            layout["text-font"] = resolved
            fonts_used.update(resolved)

    # Above roads/buildings/boundaries, below every label.
    last_road = max(
        i for i, l in enumerate(style["layers"])
        if l.get("source-layer") == "transportation" and l["type"] != "symbol"
    )
    insert_at = next(
        (i for i, l in enumerate(style["layers"])
         if i > last_road and l["type"] == "symbol"),
        len(style["layers"]),
    )
    transit_layers = _transit_layers()
    style["layers"][insert_at:insert_at] = transit_layers
    fonts_used.update(transit_layers[1]["layout"]["text-font"])

    print(f"Inserted transit layers at index {insert_at} "
          f"(after '{style['layers'][insert_at - 1]['id']}')")

    validate(style)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(style, indent=2))
    print(f"Wrote {out} — {len(style['layers'])} layers, fonts: {sorted(fonts_used)}")
    return fonts_used


def extract_fonts(zip_path: Path, out_dir: Path, fonts: set[str]):
    """Pull just the glyph ranges for the fontstacks the style references."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        total = 0
        for font in sorted(fonts):
            dest = out_dir / font
            if dest.is_dir() and any(dest.iterdir()):
                print(f"  {font}: already present, skipping")
                continue
            dest.mkdir(parents=True, exist_ok=True)
            members = [n for n in names
                       if n.startswith(f"{font}/") and n.endswith(".pbf")]
            if not members:
                raise SystemExit(f"Font '{font}' not found in {zip_path}")
            for n in members:
                (out_dir / n).write_bytes(zf.read(n))
            total += len(members)
            print(f"  {font}: {len(members)} glyph ranges")
        if total:
            print(f"Extracted {total} glyph range files into {out_dir}")


def make_sprite(out_dir: Path):
    """Emit the one icon Voyager declares (`circle-11`, a 17px dot).

    Every layer that references it sets `icon-image` to "", so nothing actually
    draws it — but MapLibre still fetches the sprite the style declares, and a
    404 there logs errors on every load. Generating it keeps the bundle
    self-contained and CARTO-free.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for suffix, ratio in (("", 1), ("@2x", 2)):
        size = 17 * ratio
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
        ctx = cairo.Context(surface)
        ctx.set_antialias(cairo.ANTIALIAS_BEST)
        ctx.set_source_rgba(1, 1, 1, 1)
        ctx.arc(size / 2, size / 2, size / 2 - ratio * 0.5, 0, 2 * 3.141592653589793)
        ctx.fill()
        surface.write_to_png(str(out_dir / f"sprite{suffix}.png"))
        (out_dir / f"sprite{suffix}.json").write_text(json.dumps({
            "circle-11": {
                "width": size, "height": size,
                "x": 0, "y": 0, "pixelRatio": ratio, "sdf": False,
            }
        }, indent=2))
    print(f"Wrote sprite/sprite@2x (png+json) into {out_dir}")


parser = ArgumentParser(
    description="Build a self-hosted MapLibre style bundle: CARTO Voyager "
                "repointed at our own PMTiles, with self-hosted glyphs and "
                "sprite, plus the transit route layers.",
    epilog="Example:\n"
           "  python make_style.py out/web --fonts-zip vendor/noto-open-sans.zip",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument("out_dir", type=Path, help="web root to write into")
parser.add_argument("--style", type=Path, default=Path("vendor/voyager-gl-style.json"),
                    help="vendored CARTO Voyager style JSON")
parser.add_argument("--fonts-zip", type=Path, default=Path("vendor/noto-open-sans.zip"),
                    help="openmaptiles/fonts release zip of prebuilt glyph ranges")
parser.add_argument("--basemap", default="./basemap.pmtiles")
parser.add_argument("--transit", default="./transit.pmtiles")
parser.add_argument("--page", type=Path, default=Path("web/index.html"),
                    help="map page copied into the bundle as index.html")

args = parser.parse_args()
used = build_style(args.style, args.out_dir / "style.json", args.basemap, args.transit)
extract_fonts(args.fonts_zip, args.out_dir / "fonts", used)
make_sprite(args.out_dir)

# The bundle has to include its own entry point: the whole point is that
# out_dir can be dropped onto nginx or S3 as-is, and a web root with no
# index.html is a directory listing, not a map.
shutil.copyfile(args.page, args.out_dir / "index.html")
print(f"Copied {args.page} -> {args.out_dir / 'index.html'}")
