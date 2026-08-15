# Stage 1: build loom binaries from source.
FROM python:3.12-slim AS loom-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake g++ make libzip-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 --recurse-submodules \
        https://github.com/ad-freiburg/loom.git
WORKDIR /build/loom
RUN mkdir build && cd build && cmake .. && make -j"$(nproc)"


# Stage 2: runtime image — Python, Cairo, libzip, our scripts, loom bins.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libcairo2 libzip4 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=loom-builder /build/loom/build/gtfs2graph /usr/local/bin/
COPY --from=loom-builder /build/loom/build/topo       /usr/local/bin/
COPY --from=loom-builder /build/loom/build/loom       /usr/local/bin/

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY download.py draw_routes.py draw_stops.py serve.py \
     run_loom.sh pipeline.sh ./
RUN chmod +x run_loom.sh pipeline.sh

ENV LOOM_BIN=/usr/local/bin

# Default: run the full pipeline. Override with e.g.
#   docker run -p 8000:8000 gtfs-tiles python serve.py /app/out/stops
CMD ["./pipeline.sh"]
