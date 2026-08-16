# The worker image. There is no server image: nginx serves the site from the
# files this writes, out of a shared volume.
#
# It carries the site build as well as the loaders, because building the site
# is one of the worker's jobs — stop names and route pills live in the HTML, so
# a new GTFS feed means new pages.

FROM node:24-alpine

WORKDIR /app

# Package files first, so a source change doesn't reinstall the world
COPY package*.json ./

# Eleventy and tsx are runtime dependencies here: the worker shells out to one
# and is executed by the other.
RUN npm ci --omit=dev

COPY . .

# MapLibre and the PMTiles shim are copied out of node_modules for the map page
# to load directly. The site build does this too, but doing it here means the
# image is complete before it runs.
RUN node scripts/copy-map-vendor.mjs

RUN addgroup --system --gid 1001 appgroup
RUN adduser --system --uid 1001 appuser

# The site and data directories are volumes shared with nginx, and the worker
# is the only writer.
RUN mkdir -p /app/_site /app/_data && chown -R appuser:appgroup /app/_site /app/_data

USER appuser

CMD ["npm", "run", "worker"]
