#!/usr/bin/env bash
# End-to-end build: GTFS feed + OpenStreetMap -> a static website of vector
# tiles. The output directory is plain files; drop it on any host that honours
# HTTP range requests and you have a map. No tile server, no backend.
#
# Every step skips work already on disk, so re-runs are cheap. Delete the
# artefact you want rebuilt.
#
# Local usage:
#   ./pipeline.sh
#   GTFS_URL=https://... AREA=vermont ./pipeline.sh
#   python serve.py out/web
#
# Dockerized:
#   docker build -t gtfs-tiles .
#   docker run --rm -v "$(pwd)/out:/app/out" -v "$(pwd)/vendor:/app/vendor" gtfs-tiles
#   docker run --rm -p 8000:8000 -v "$(pwd)/out:/app/out" gtfs-tiles \
#       python serve.py /app/out/web --port 8000
#
# What each stage produces:
#
#   vendor/       planetiler.jar and the glyph pack (large, downloaded once)
#   out/gtfs.zip  the feed
#   out/web/basemap.pmtiles   OSM basemap, OpenMapTiles schema, ~5 min, ~120 MB
#   out/loom-{overview,detail}.geojson   two line graphs, see make_graphs.sh
#   out/web/transit.pmtiles   routes + stops
#   out/web/{style.json,style-dark.json,sprite-*,fonts/,index.html}  the rest
#                             of the site — one style per appearance, both
#                             reading the same two archives. Sprite filenames
#                             and the archive URLs in the styles carry a
#                             fingerprint of their contents, so a rebuilt
#                             bundle is a set of new URLs and can be cached
#                             hard without a stale map surviving it.
#
# Environment knobs (defaults shown):
#   GTFS_URL        GTFS feed URL                (Portland, ME GPTD)
#   AREA            planetiler region            maine
#   MODE            loom GTFS route_type filter  bus
#   OVERVIEW_DIST   topo -d for the merged graph        120
#   OVERVIEW_SMOOTH topo --smooth for that graph         50
#   DETAIL_DIST     topo -d for the detailed graph       10
#   CROSS_PEN       loom --same-seg-cross-pen            30
#   OVERVIEW_ZOOMS  zoom range served by the merged graph   9-13
#   DETAIL_ZOOMS    zoom range served by the detail graph  14-16
#   SOLO_SCALE      width ceiling for a single line      0.5
#   OUT             output root                          ./out
#   JAVA_HEAP       planetiler heap                      8g

set -euo pipefail

GTFS_URL="${GTFS_URL:-https://gtfs.gptd.cadavl.com/GPTD/GTFS/GTFS_GPTD.zip}"
AREA="${AREA:-maine}"
MODE="${MODE:-bus}"
OVERVIEW_ZOOMS="${OVERVIEW_ZOOMS:-9-13}"
DETAIL_ZOOMS="${DETAIL_ZOOMS:-14-16}"
SOLO_SCALE="${SOLO_SCALE:-0.5}"
OUT="${OUT:-./out}"
JAVA_HEAP="${JAVA_HEAP:-8g}"

PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"
FONTS_URL="https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-open-sans.zip"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$SCRIPT_DIR/vendor"
PY="${PYTHON:-python}"
WEB="$OUT/web"
mkdir -p "$OUT" "$WEB" "$VENDOR"

echo "==> Vendored dependencies"
if [ ! -f "$VENDOR/planetiler.jar" ]; then
    echo "    fetching planetiler.jar (~90 MB)"
    curl -fL --retry 3 -o "$VENDOR/planetiler.jar" "$PLANETILER_URL"
else
    echo "    planetiler.jar present"
fi
if [ ! -f "$VENDOR/noto-open-sans.zip" ]; then
    echo "    fetching glyph pack (~60 MB)"
    curl -fL --retry 3 -o "$VENDOR/noto-open-sans.zip" "$FONTS_URL"
else
    echo "    glyph pack present"
fi

echo "==> GTFS feed"
if [ ! -f "$OUT/gtfs.zip" ]; then
    curl -fL --retry 3 -o "$OUT/gtfs.zip" "$GTFS_URL"
else
    echo "    $OUT/gtfs.zip present"
fi

# The basemap is the slow, heavy step and has nothing to do with the transit
# data, so it is skipped whenever the archive already exists. Delete it to
# rebuild against fresher OSM.
echo "==> Basemap (OpenStreetMap via planetiler)"
if [ ! -f "$WEB/basemap.pmtiles" ]; then
    echo "    building '$AREA' — several minutes, downloads ~1 GB of sources"
    java -Xmx"$JAVA_HEAP" -jar "$VENDOR/planetiler.jar" \
        --download --area="$AREA" --output="$WEB/basemap.pmtiles" --force
else
    echo "    $WEB/basemap.pmtiles present"
fi

echo "==> Line graphs (gtfs2graph | topo | loom, twice)"
"$SCRIPT_DIR/make_graphs.sh" "$OUT/gtfs.zip" "$OUT" "$MODE"

echo "==> Transit tiles"
"$PY" "$SCRIPT_DIR/make_transit_tiles.py" "$WEB/transit.pmtiles" \
    --source "$OUT/loom-overview.geojson:$OVERVIEW_ZOOMS" \
    --source "$OUT/loom-detail.geojson:$DETAIL_ZOOMS" \
    --gtfs "$OUT/gtfs.zip" \
    --sprite-table "$OUT/stop-sprites.json" \
    --solo-scale "$SOLO_SCALE" \
    --attribution '&copy; OpenStreetMap contributors'

echo "==> Style bundle (style.json, glyphs, sprites, page)"
"$PY" "$SCRIPT_DIR/make_style.py" "$WEB" \
    --fonts-zip "$VENDOR/noto-open-sans.zip" \
    --sprite-table "$OUT/stop-sprites.json"

echo
echo "==> Done. $WEB is a complete static site:"
du -sh "$WEB"/* 2>/dev/null | sed 's/^/    /'
echo
echo "    Serve it:    $PY serve.py $WEB"
echo "    Deploy it:   aws s3 sync $WEB s3://your-bucket/"
echo
echo "    Anything that honours HTTP range requests will do — PMTiles is read"
echo "    by fetching byte ranges, so a server without them serves the whole"
echo "    basemap for every tile. python -m http.server is NOT sufficient."
