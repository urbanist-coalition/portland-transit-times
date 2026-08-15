#!/usr/bin/env bash
# Build the two line graphs the vector tileset is assembled from.
#
# A route's two directions on a divided road sit ~20-40 m apart. Whether they
# should be drawn as one line or two is not a property of the data — it is a
# property of the zoom:
#
#   z13 and below   ~20 m is under 1.5 px. Two lines is noise; merge them.
#   z14 and above   ~20 m is 3 px and climbing. One line is a lie; keep both.
#
# There is no single topo -d that satisfies both, and hunting for one just
# moves the zoom at which it looks wrong. Vector tiles do not need one answer,
# so build two graphs and let make_transit_tiles.py serve each over the zoom
# range it suits.
#
#   OVERVIEW  large -d, aggressively self-merged. --smooth matters here: at
#             this distance the merged centreline is assembled from both
#             carriageways and can snap between them.
#   DETAIL    small -d. Only fuses geometry that genuinely coincides, so real
#             carriageways and one-way pairs survive. Routes sharing a street
#             still bundle, because their shapes there are near-identical.
#
# A caveat on reproducibility. loom identifies graph nodes by heap address, and
# emits those addresses as ids. topo iterates containers keyed on them, so the
# addresses decide merge tie-breaks. Anything that shifts the heap therefore
# changes the graph slightly — ASLR between runs, and, less obviously, the
# *length of the input path*, since a longer filename shifts later allocations:
#
#     gtfs.zip                     -> 1083 edges
#     /tmp/.../g.zip               -> 1093 edges
#     /tmp/.../a-much-longer….zip  -> 1088 edges     (identical feed contents)
#
# The spread is about 1% of edges and under 0.5% of total length, so it does not
# show on the map, but it does mean these graphs are not byte-reproducible and
# two builds of "the same" data can differ. For a stable artefact, build from a
# fixed path; `setarch $(uname -m) -R` additionally pins ASLR.
#
# Usage:
#   ./make_graphs.sh [gtfs.zip] [out-dir] [mode]
#
# Environment (defaults shown):
#   OVERVIEW_DIST   120   topo -d for the merged graph
#   OVERVIEW_SMOOTH  50   topo --smooth for the merged graph
#   DETAIL_DIST      10   topo -d for the detailed graph
#   CROSS_PEN        30   loom --same-seg-cross-pen

set -euo pipefail

GTFS="${1:-gtfs.zip}"
OUT="${2:-out}"
MODE="${3:-bus}"

OVERVIEW_DIST="${OVERVIEW_DIST:-120}"
OVERVIEW_SMOOTH="${OVERVIEW_SMOOTH:-50}"
DETAIL_DIST="${DETAIL_DIST:-10}"
CROSS_PEN="${CROSS_PEN:-30}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"

echo "==> Overview graph (-d $OVERVIEW_DIST --smooth $OVERVIEW_SMOOTH)"
AGGR_DIST="$OVERVIEW_DIST" SMOOTH="$OVERVIEW_SMOOTH" CROSS_PEN="$CROSS_PEN" \
    "$SCRIPT_DIR/run_loom.sh" "$GTFS" "$OUT/loom-overview.geojson" "$MODE"

echo "==> Detail graph (-d $DETAIL_DIST)"
AGGR_DIST="$DETAIL_DIST" SMOOTH=0 CROSS_PEN="$CROSS_PEN" \
    "$SCRIPT_DIR/run_loom.sh" "$GTFS" "$OUT/loom-detail.geojson" "$MODE"

echo "==> Done. Next:"
echo "    python make_transit_tiles.py $OUT/web/transit.pmtiles \\"
echo "        --source $OUT/loom-overview.geojson:9-13 \\"
echo "        --source $OUT/loom-detail.geojson:14-16 \\"
echo "        --gtfs $GTFS --sprite-table $OUT/stop-sprites.json"
echo "    python make_style.py $OUT/web --sprite-table $OUT/stop-sprites.json"
echo "    python serve.py $OUT/web"
