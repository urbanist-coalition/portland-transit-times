# One image, two roles.
#
#   worker    realtime feeds -> the current release's arrivals and pages
#   builder   the feed -> a whole new release, and the flip
#
# They share this image because they share code — the same renderer fills a
# page in both — but they run as separate containers, so a five-minute map
# build never blocks the loop that has a second to do its work.
#
# It carries both toolchains: Node for the app and the site build, Python, a
# JRE and loom for the map. That is what folding the tile pipeline into this
# repository bought — one context, one build, and a release described by one
# commit.

# Stage 1: the loom binaries. Only three of its tools are used; `octi` and
# `transitmap` produce schematic maps, and this pipeline renders geographically.
FROM python:3.12-slim-trixie AS loom

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake g++ make libzip-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 --recurse-submodules \
        https://github.com/ad-freiburg/loom.git
WORKDIR /build/loom
RUN mkdir build && cd build && cmake .. && make -j"$(nproc)"


# Stage 2: the runtime, Node-based because that is what coordinates.
FROM node:24-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip libcairo2 libzip5 \
        openjdk-21-jre-headless curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=loom /build/loom/build/gtfs2graph /usr/local/bin/
COPY --from=loom /build/loom/build/topo       /usr/local/bin/
COPY --from=loom /build/loom/build/loom       /usr/local/bin/

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tiles/requirements.txt ./tiles/
RUN pip3 install --no-cache-dir --break-system-packages -r tiles/requirements.txt

COPY . .

# MapLibre and the PMTiles shim are copied out of node_modules for the map page
# to load directly.
RUN node scripts/copy-map-vendor.mjs

RUN addgroup --system --gid 1001 appgroup \
 && adduser --system --uid 1001 appuser \
 && mkdir -p /srv/releases /srv/_data /app/tiles/out \
 && chown -R appuser:appgroup /srv/releases /srv/_data /app/tiles/out

USER appuser

ENV RELEASES_DIR=/srv/releases \
    DATA_DIR=/srv/_data \
    TILES_WORK_DIR=/app/tiles/out

CMD ["npm", "run", "worker"]
