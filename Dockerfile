# Stage 1: build the loom binaries we actually use.
#
# Only three of loom's tools are needed. `octi` (octilinearisation) and
# `transitmap` (SVG/MVT rendering) are deliberately left out: they produce
# schematic maps, and this pipeline renders geographically, with MapLibre doing
# the drawing from vector tiles.
FROM python:3.12-slim AS loom-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake g++ make libzip-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 --recurse-submodules \
        https://github.com/ad-freiburg/loom.git
WORKDIR /build/loom
RUN mkdir build && cd build && cmake .. && make -j"$(nproc)"


# Stage 2: runtime.
#
# The JRE is here for planetiler, which builds the OSM basemap. That step is
# skipped whenever out/web/basemap.pmtiles already exists, so mounting a volume
# for out/ means it runs once rather than per container.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libcairo2 libzip4 curl ca-certificates openjdk-21-jre-headless \
 && rm -rf /var/lib/apt/lists/*

COPY --from=loom-builder /build/loom/build/gtfs2graph /usr/local/bin/
COPY --from=loom-builder /build/loom/build/topo       /usr/local/bin/
COPY --from=loom-builder /build/loom/build/loom       /usr/local/bin/

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY make_graphs.sh run_loom.sh pipeline.sh ./
COPY make_transit_tiles.py make_style.py serve.py ./
COPY web/ ./web/
COPY vendor/voyager-gl-style.json vendor/README.md ./vendor/
RUN chmod +x run_loom.sh pipeline.sh make_graphs.sh

ENV LOOM_BIN=/usr/local/bin

# planetiler.jar and the glyph pack are ~150 MB between them and are fetched by
# pipeline.sh into vendor/. Mount that as a volume to keep them across runs.
VOLUME ["/app/out", "/app/vendor"]

EXPOSE 8000

# Build everything. To serve instead:
#   docker run -p 8000:8000 -v "$(pwd)/out:/app/out" gtfs-tiles \
#       python serve.py /app/out/web --port 8000
CMD ["./pipeline.sh"]
