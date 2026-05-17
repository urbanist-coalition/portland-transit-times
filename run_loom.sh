#!/usr/bin/env bash
# Run the loom pipeline on a GTFS feed to produce an overlap-free line graph
# with optimal route orderings at shared corridors.
#
# Install loom (one-time setup), either:
#
#   From source:
#     git clone --recurse-submodules https://github.com/ad-freiburg/loom.git
#     cd loom && mkdir build && cd build && cmake .. && make -j
#     sudo make install         # or use ./build/<tool> directly
#
#   Via Docker:
#     git clone --recurse-submodules https://github.com/ad-freiburg/loom.git
#     cd loom && docker build -t loom .
#     Then run this script with USE_DOCKER=1.
#
# Pipeline:
#   gtfs2graph  GTFS  -> GeoJSON line graph (raw, with overlapping edges)
#   topo              -> merge overlapping edges, clean topology
#   loom              -> assign optimal line orderings at each shared edge
#
# Usage:
#   ./run_loom.sh [gtfs.zip] [loom.geojson] [mode]
#   USE_DOCKER=1 ./run_loom.sh ...
#   AGGR_DIST=150 ./run_loom.sh ...    # tune topo's segment-merging tolerance
#
# Mode is the GTFS route_type filter: bus, tram, subway, rail, ferry, ...
#
# AGGR_DIST (meters, default 50) is `topo -d` — the max distance between two
# segments for them to be merged into one shared edge. Bump it (100, 200) if
# routes that share the same street still appear as parallel non-bundled lines
# (GTFS shapes for the same street can drift apart, especially for hand-traced
# feeds). Too high and unrelated parallel streets collapse together.

set -euo pipefail

GTFS="${1:-gtfs.zip}"
OUT="${2:-loom.geojson}"
MODE="${3:-bus}"
USE_DOCKER="${USE_DOCKER:-0}"
AGGR_DIST="${AGGR_DIST:-50}"
CROSS_PEN="${CROSS_PEN:-4}"   # loom --same-seg-cross-pen. Bump (20-50) to
                              # discourage routes swapping positions within
                              # a shared corridor.
LOOM_BIN="${LOOM_BIN:-$HOME/src/loom/build}"

if [ "$USE_DOCKER" = "1" ]; then
    docker run --rm -i -v "$PWD:/data" loom gtfs2graph -m "$MODE" "/data/$GTFS" \
        | docker run --rm -i loom topo -d "$AGGR_DIST" \
        | docker run --rm -i loom loom --same-seg-cross-pen "$CROSS_PEN" > "$OUT"
else
    # Prepend LOOM_BIN to PATH so the tools resolve without a system install.
    export PATH="$LOOM_BIN:$PATH"
    gtfs2graph -m "$MODE" "$GTFS" \
        | topo -d "$AGGR_DIST" \
        | loom --same-seg-cross-pen "$CROSS_PEN" > "$OUT"
fi

echo "Wrote $OUT"
