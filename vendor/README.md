# Vendored third-party assets

## voyager-gl-style.json, darkmatter-gl-style.json  (committed)

CARTO's Voyager and Dark Matter basemap styles — the light and dark
appearances — fetched from

    https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json
    https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json

Upstream: <https://github.com/CartoDB/basemap-styles>

Licensed by CARTO under **BSD-3-Clause** (the style code) and **CC-BY 4.0**
(the visual design). Both require the copyright notice to travel with
redistributions, which is why these files are vendored with this note rather
than fetched at build time.

The two are the same 93 layers over the same OpenMapTiles schema, differing
only in paint, so `make_style.py` runs the identical transformation over each
and emits `style.json` and `style-dark.json` into one bundle.

CARTO's *tile service* is a separate matter: it is restricted to enterprise
customers and is **not** used here. `make_style.py` repoints every URL in these
styles at our own PMTiles, glyphs, and sprites, so nothing at runtime touches
cartocdn.com. The styles are the only thing taken from CARTO.

Maps built from this must carry the attribution `make_style.py` sets:

    © OpenStreetMap contributors  © OpenMapTiles  © CARTO

## Not committed (downloaded on demand — see `.gitignore`)

| Path                     | Size  | Source |
|--------------------------|-------|--------|
| `planetiler.jar`         | 89 MB | <https://github.com/onthegomap/planetiler/releases/latest> |
| `noto-open-sans.zip`     | 61 MB | <https://github.com/openmaptiles/fonts/releases/tag/v2.0> |
| `../data/`               | 1.5 GB | planetiler's OSM extract + Natural Earth + scratch space |

`planetiler.jar` builds the OpenStreetMap basemap (ODbL data, OpenMapTiles
schema). `noto-open-sans.zip` supplies the prebuilt glyph ranges that
`make_style.py` extracts — the Voyager style's own fontstacks are five deep and
name fonts we don't host, so each stack collapses to CARTO's declared fallback,
Open Sans.
