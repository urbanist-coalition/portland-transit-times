#!/usr/bin/env bash
# Rebuild the OpenStreetMap basemap, and nothing else.
#
# This is the one heavy job in the system: planetiler downloads about a
# gigabyte of sources — water polygons, Natural Earth, the region extract — and
# spends minutes turning them into a 117 MB archive. It also has nothing to do
# with the transit feed, so it does not belong in the release cycle: a bus stop
# moving is no reason to re-cut Maine.
#
# Run it monthly, when the buses are not running:
#
#   docker compose --profile basemap run --rm basemap
#
# The container it runs in has a hard memory limit, so an overrun kills this
# and nothing else. The default heap is deliberately far below the 8g the
# pipeline once suggested — Maine's extract is 87 MB, and `--storage=mmap` lets
# planetiler spill to disk rather than fight the box for RAM.

set -euo pipefail

AREA="${AREA:-maine}"
JAVA_HEAP="${JAVA_HEAP:-768m}"
OUT="${OUT:-./out}"
STORAGE="${STORAGE:-mmap}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$SCRIPT_DIR/vendor"
WEB="$OUT/web"
mkdir -p "$WEB" "$VENDOR"

if [ ! -f "$VENDOR/planetiler.jar" ]; then
    echo "==> fetching planetiler.jar (~90 MB)"
    curl -fL --retry 3 -o "$VENDOR/planetiler.jar" \
        "https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"
fi

# Written beside the live one and moved into place, so a failed or killed run
# leaves the existing basemap serving. The temporary name keeps the .pmtiles
# suffix: planetiler picks its archive format from the extension and rejects
# anything else.
echo "==> building '$AREA' with -Xmx$JAVA_HEAP --storage=$STORAGE"
java -Xmx"$JAVA_HEAP" -jar "$VENDOR/planetiler.jar" \
    --download --area="$AREA" --storage="$STORAGE" \
    --output="$WEB/basemap.new.pmtiles" --force

mv "$WEB/basemap.new.pmtiles" "$WEB/basemap.pmtiles"
echo "==> done: $(du -h "$WEB/basemap.pmtiles" | cut -f1)"
echo "    the next release will pick it up; its URL carries a content hash, so"
echo "    browsers fetch it again only because it actually changed."
