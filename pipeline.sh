#!/usr/bin/env bash
# End-to-end build: GTFS feed + basemap CDN -> rendered route + stop tile
# pyramid ready to serve. Each step skips work that's already on disk, so
# re-runs are cheap.
#
# Local usage:
#   ./pipeline.sh
#   GTFS_URL=https://... THEME=darkmatter ./pipeline.sh
#
# Dockerized:
#   docker build -t gtfs-tiles .
#   docker run --rm -v "$(pwd)/out:/app/out" gtfs-tiles
#   docker run --rm -p 8000:8000 -v "$(pwd)/out:/app/out" \
#       gtfs-tiles python serve.py /app/out/stops
#
# Environment knobs (defaults shown):
#   GTFS_URL   GTFS feed URL                (Portland, ME GPTD)
#   THEME      Carto basemap theme          positron
#   MODE       loom GTFS route_type filter  bus
#   BBOX       four floats: W S E N         -70.85 43.34 -69.71 44.10
#   MIN_ZOOM / MAX_ZOOM                     10 / 18
#   AGGR_DIST  topo segment-merging meters  100
#   CROSS_PEN  loom same-seg-cross penalty  30
#   OUT        output root dir              ./out

set -euo pipefail

GTFS_URL="${GTFS_URL:-https://gtfs.gptd.cadavl.com/GPTD/GTFS/GTFS_GPTD.zip}"
THEME="${THEME:-positron}"
MODE="${MODE:-bus}"
BBOX="${BBOX:--70.85 43.34 -69.71 44.10}"
MIN_ZOOM="${MIN_ZOOM:-10}"
MAX_ZOOM="${MAX_ZOOM:-18}"
AGGR_DIST="${AGGR_DIST:-100}"
CROSS_PEN="${CROSS_PEN:-30}"
OUT="${OUT:-./out}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"

echo "==> Fetching GTFS feed"
curl -fL --retry 3 -o "$OUT/gtfs.zip" "$GTFS_URL"

echo "==> Downloading basemap tiles ($THEME, zoom $MIN_ZOOM-$MAX_ZOOM)"
python "$SCRIPT_DIR/download.py" "$OUT/raw" "$THEME" \
    --bbox $BBOX --min-zoom "$MIN_ZOOM" --max-zoom "$MAX_ZOOM"

echo "==> Running loom (aggr-dist=$AGGR_DIST, cross-pen=$CROSS_PEN)"
AGGR_DIST="$AGGR_DIST" CROSS_PEN="$CROSS_PEN" \
    "$SCRIPT_DIR/run_loom.sh" "$OUT/gtfs.zip" "$OUT/loom.geojson" "$MODE"

echo "==> Drawing routes"
python "$SCRIPT_DIR/draw_routes.py" "$OUT/raw" "$OUT/routes" "$OUT/loom.geojson"

echo "==> Drawing stops"
python "$SCRIPT_DIR/draw_stops.py" "$OUT/routes" "$OUT/stops" "$OUT/gtfs.zip"

echo "==> Done. Final tile pyramid: $OUT/stops"
echo "    Serve with: python serve.py $OUT/stops"
