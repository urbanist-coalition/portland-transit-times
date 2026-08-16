"""Build fully self-hosted MapLibre style bundles from CARTO's base styles.

Two styles come out, one per appearance: Voyager for light, Dark Matter for
dark. They share everything expensive — the same basemap archive, the same
transit archive, the same glyph ranges — and differ only in the JSON and in
which sprite sheet they point at, so the second appearance costs a few hundred
kilobytes rather than another copy of the map. A page switches between them at
runtime with `map.setStyle()`.

CARTO's styles are open source (BSD-3 for the code, CC-BY 4.0 for the
design), but CARTO's *tile service* is enterprise-only. Happily the styles are
written against the OpenMapTiles schema — the same schema planetiler emits — so
they render unmodified against our own basemap once the URLs are repointed.
Four things tether a stock style to CARTO's CDN, and this script cuts all of
them:

  sources   -> pmtiles://./basemap.pmtiles  (planetiler, from OSM)
  glyphs    -> ./fonts/{fontstack}/{range}.pbf
  sprite    -> ./sprite  (or ./sprite-dark)
  text-font -> rewritten to fonts we actually host

That last one needs explaining. Every fontstack in these styles is five deep,
e.g.

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

import hashlib
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

# Everything about the transit layers that depends on which appearance the
# style is for. The basemap's half of that difference is CARTO's, already baked
# into the two source styles; this is the half we add.
#
# `pie_outline` is the odd one out. Line colours and label colours are style
# properties and restyle live, but the stop pies are raster sprites, so their
# outline is a *pixel* and needs a second sheet rather than a second paint
# property. Hence `sprite` here as well: each style points at its own sheet.
THEMES = {
    "light": {
        "style": "style.json",
        "sprite": "sprite",
        "halo": "#ffffff",
        "stop_label": "#333333",
        # Darker than the grey[700] the React marker used: a stop sits on top
        # of its own route line, in its own colour, and the ring is the only
        # thing separating the two.
        "pie_outline": (0.22, 0.22, 0.22),
    },
    "dark": {
        "style": "style-dark.json",
        "sprite": "sprite-dark",
        # Dark Matter's own background colour, so halos read as the map showing
        # through the label rather than as a second stroke around it.
        "halo": "#0e0e0e",
        "stop_label": "#e9edf1",
        # Still short of white — a ring this thick reads as a halo if it is
        # too bright — but light enough to cut a route line in half.
        "pie_outline": (0.68, 0.71, 0.75),
    },
}


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


def _transit_layers(theme: dict) -> list[dict]:
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
                "text-halo-color": theme["halo"],
                "text-halo-width": 1.5,
            },
        },
        {
            # Stops, from the feed itself: real kerbside positions, with one
            # slice per route that actually *stops* here.
            #
            # Taken from GTFS rather than loom's station nodes deliberately. A
            # marker spanning the corridor would assert that every route in the
            # bundle stops there, which is false at 204 of 282 multi-route stops
            # in this feed, and loom's nodes collapse the 318 stops that have a
            # counterpart across the street into one point — discarding which
            # kerb the pole is on. Both matter for a map whose job is helping
            # someone find the stop.
            #
            # The cost is that a marker sits ~6.5 m off the drawn line rather
            # than on it, which is under 4 px at z16, and is where the pole is.
            #
            # allow-overlap is on because these are positional markers, not
            # labels: dropping one would misinform.
            "id": "transit-stops-pie",
            "type": "symbol",
            "source": "transit",
            "source-layer": "gtfs_stops",
            "minzoom": 14,
            "layout": {
                "icon-image": ["get", "sprite"],
                "icon-size": ["interpolate", ["linear"], ["zoom"],
                              14, 12 / PIE_PX, 15, 16 / PIE_PX,
                              18, 23 / PIE_PX, 20, 27 / PIE_PX],
                "icon-allow-overlap": True,
                "icon-ignore-placement": True,
            },
        },
        {
            # Stop names. Nothing was added to the tiles for this — `name` was
            # already on the stop features, so labels are a style-only change.
            #
            # Unlike the pie icons, which are baked PNGs, text is genuinely
            # vector: SDF glyphs from the self-hosted Open Sans, restyleable
            # live and sharp at any size.
            #
            # Decluttering is the entire design here, not a refinement. A
            # 23-character name is ~126 px wide while cross-street twins sit
            # 13 px apart at z16, so most labels *must* be dropped. Leaving
            # allow-overlap off lets MapLibre do that, and symbol-sort-key
            # decides who survives: lower sorts first, so negating the route
            # count means the busiest stop in any cluster keeps its label.
            "id": "transit-stop-labels",
            "type": "symbol",
            "source": "transit",
            "source-layer": "gtfs_stops",
            "minzoom": 16,
            "layout": {
                "text-field": ["get", "name"],
                "text-font": ["Open Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 16, 10, 19, 13],
                "text-anchor": "top",
                "text-offset": [0, 0.9],
                "text-max-width": 9,
                "text-padding": 4,
                "symbol-sort-key": ["-", 0, ["get", "n_routes"]],
            },
            "paint": {
                "text-color": theme["stop_label"],
                "text-halo-color": theme["halo"],
                "text-halo-width": 1.5,
            },
        },
    ]


def fingerprint(path: Path) -> str:
    """Eight hex characters of the file's contents.

    Every build writes the same filenames, so without something in the URL that
    changes with the bytes, a browser told to cache these for a month will do
    exactly that and never see a rebuilt map. Content rather than mtime, so
    copying the bundle to a server does not invalidate 117 MB for nothing.

    For the archives this is not only about staleness: a PMTiles file is read
    by byte range, and a client holding cached ranges from one build alongside
    fresh ranges from another would be reading offsets from one file into the
    data of another.
    """
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()[:8]


def _versioned(url: str, out_dir: Path) -> str:
    """Appends a content fingerprint to a bundle-relative URL, if it is a file
    we actually have. The pmtiles protocol and the glyph template both pass a
    query string straight through to fetch, so this is safe for both."""
    path = out_dir / url.lstrip("./")
    if not path.is_file():
        return url
    return f"{url}?v={fingerprint(path)}"


def build_style(src: Path, out: Path, basemap: str, transit: str,
                theme: dict, sprite_base: str) -> set[str]:
    style = json.loads(src.read_text())

    out_dir = out.parent
    style["sources"] = {
        "carto": {  # keep the name: all 93 stock layers reference it
            "type": "vector",
            "url": f"pmtiles://{_versioned(basemap, out_dir)}",
            "attribution": ATTRIBUTION,
        },
        "transit": {
            "type": "vector",
            "url": f"pmtiles://{_versioned(transit, out_dir)}",
        },
    }
    # Glyph ranges are identified by the fontstack they belong to and never
    # change under it, so they need no version.
    style["glyphs"] = "./fonts/{fontstack}/{range}.pbf"
    # The sprite carries its version in the filename instead: MapLibre builds
    # the sheet URLs by appending "@2x" and ".json" to this, and a query would
    # have to survive that joining.
    style["sprite"] = f"./{sprite_base}"

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
    transit_layers = _transit_layers(theme)
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


# Pie markers for the kerbside stop layer. Drawn at PIE_PX and scaled by the
# style, following draw_stops.py's zoomIconSizes table (14px at z15 -> 24 at z20).
PIE_PX = 24
# Ring width in the same units the pie is drawn in, so it scales with the
# marker. Wide enough to survive being drawn over a line of its own colour.
PIE_OUTLINE_PX = 4.0


def _draw_pie(ctx, cx, cy, size, colors, ratio, outline_rgb):
    """One slice per route that stops here.

    A single-route stop is a solid dot, which is 82% of them — the pie only
    does work on the rest. Crucially the slices are the routes that *stop*
    here, not the routes that pass through, so a route running express is
    simply absent. That is the distinction the corridor-spanning pill cannot
    make, and it is wrong about at 72% of multi-route stops.
    """
    import math as _m
    # `size` already carries the pixel ratio, so the ring must not be scaled by
    # it twice — which it was, leaving the @2x sheet with a ring twice the
    # relative width of the @1x one.
    outline = PIE_OUTLINE_PX * ratio
    radius = size / 2.0 - outline / 2.0
    n = len(colors)
    if n == 1:
        r, g, b = colors[0]
        ctx.set_source_rgb(r, g, b)
        ctx.arc(cx, cy, radius, 0, 2 * _m.pi)
        ctx.fill()
    else:
        for i, (r, g, b) in enumerate(colors):
            start = (i - 0.5) / n * 2 * _m.pi
            end = (i + 0.5) / n * 2 * _m.pi
            ctx.set_source_rgb(r, g, b)
            ctx.move_to(cx, cy)
            ctx.arc(cx, cy, radius, start, end)
            ctx.close_path()
            ctx.fill()
    ctx.set_source_rgb(*outline_rgb)
    ctx.set_line_width(outline)
    ctx.arc(cx, cy, radius, 0, 2 * _m.pi)
    ctx.stroke()


def _hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def make_sprite(out_dir: Path, pies: dict | None, sheet: str,
                outline_rgb: tuple[float, float, float]):
    """Emit one sprite sheet: CARTO's `circle-11` plus one pie per route set.

    `circle-11` is declared by 11 stock layers, all of which set `icon-image`
    to "", so nothing draws it — but MapLibre still fetches the sprite a style
    declares, and a 404 there logs errors on every load.

    The pies come from the tiler's sprite table: one per distinct set of routes
    serving a stop, 44 for this feed. Baking them is what makes them raster
    rather than vector — a route colour change means regenerating this sheet,
    unlike the lines, which restyle live from tile attributes.

    That bakedness is also why each appearance gets its own sheet, under its
    own `sheet` name: the ring around a pie has to change with the map underneath it,
    and a PNG cannot be restyled at runtime the way `text-color` can.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for suffix, ratio in (("", 1), ("@2x", 2)):
        circle = 17 * ratio
        pad = 2 * ratio
        pie = PIE_PX * ratio
        n_pies = len(pies or {})
        sheet_w = circle + pad + n_pies * (pie + pad)
        sheet_h = max(circle, pie + pad)

        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, int(sheet_w), int(sheet_h))
        ctx = cairo.Context(surface)
        ctx.set_antialias(cairo.ANTIALIAS_BEST)

        index = {}
        ctx.set_source_rgba(1, 1, 1, 1)
        ctx.arc(circle / 2, circle / 2, circle / 2 - ratio * 0.5, 0, 2 * 3.14159265358979)
        ctx.fill()
        index["circle-11"] = {"width": circle, "height": circle, "x": 0, "y": 0,
                              "pixelRatio": ratio, "sdf": False}

        x = circle + pad
        for name, spec in sorted((pies or {}).items()):
            colors = [_hex_rgb(c) for c in spec["colors"]]
            _draw_pie(ctx, x + pie / 2, pie / 2, pie, colors, ratio, outline_rgb)
            index[name] = {"width": int(pie), "height": int(pie),
                           "x": int(x), "y": 0,
                           "pixelRatio": ratio, "sdf": False}
            x += int(pie) + pad

        surface.write_to_png(str(out_dir / f"{sheet}{suffix}.png"))
        (out_dir / f"{sheet}{suffix}.json").write_text(json.dumps(index, indent=2))

    # Rename to include a fingerprint of the sheet, so the style can point at a
    # URL that changes whenever the pies do.
    versioned = f"{sheet}-{fingerprint(out_dir / f'{sheet}.png')}"
    for suffix in ("", "@2x"):
        for extension in ("png", "json"):
            (out_dir / f"{sheet}{suffix}.{extension}").rename(
                out_dir / f"{versioned}{suffix}.{extension}")
    print(f"Wrote {versioned}: {len(pies or {})} stop pies into {out_dir}")
    return versioned


parser = ArgumentParser(
    description="Build the self-hosted MapLibre style bundle: CARTO Voyager "
                "and Dark Matter repointed at our own PMTiles, with "
                "self-hosted glyphs and sprites, plus the transit route "
                "layers. One style per appearance, sharing everything else.",
    epilog="Example:\n"
           "  python make_style.py out/web --fonts-zip vendor/noto-open-sans.zip",
    formatter_class=RawDescriptionHelpFormatter,
)
parser.add_argument("out_dir", type=Path, help="web root to write into")
parser.add_argument("--style", type=Path, default=Path("vendor/voyager-gl-style.json"),
                    help="vendored CARTO Voyager style JSON (light)")
parser.add_argument("--dark-style", type=Path,
                    default=Path("vendor/darkmatter-gl-style.json"),
                    help="vendored CARTO Dark Matter style JSON (dark)")
parser.add_argument("--fonts-zip", type=Path, default=Path("vendor/noto-open-sans.zip"),
                    help="openmaptiles/fonts release zip of prebuilt glyph ranges")
parser.add_argument("--basemap", default="./basemap.pmtiles")
parser.add_argument("--transit", default="./transit.pmtiles")
parser.add_argument("--sprite-table", type=Path,
                    help="pie sprite table written by make_transit_tiles.py")
parser.add_argument("--page", type=Path, default=Path("web/index.html"),
                    help="map page copied into the bundle as index.html")

args = parser.parse_args()
pies = json.loads(args.sprite_table.read_text()) if args.sprite_table and args.sprite_table.exists() else {}

sources = {"light": args.style, "dark": args.dark_style}
used: set[str] = set()
for name, theme in THEMES.items():
    src = sources[name]
    if not src.is_file():
        raise SystemExit(f"No {name} source style at {src}")
    print(f"==> {name}: {src.name}")
    sprite_base = make_sprite(args.out_dir, pies, theme["sprite"],
                              theme["pie_outline"])
    used |= build_style(src, args.out_dir / theme["style"], args.basemap,
                        args.transit, theme, sprite_base)

# Both styles resolve to the same fontstacks, so the glyph ranges are extracted
# once for the union rather than per style.
extract_fonts(args.fonts_zip, args.out_dir / "fonts", used)

# The bundle has to include its own entry point: the whole point is that
# out_dir can be dropped onto nginx or S3 as-is, and a web root with no
# index.html is a directory listing, not a map.
shutil.copyfile(args.page, args.out_dir / "index.html")
print(f"Copied {args.page} -> {args.out_dir / 'index.html'}")
