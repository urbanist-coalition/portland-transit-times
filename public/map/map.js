/**
 * @file The map page.
 *
 * There is no framework here, and no state to keep in sync, because the map is
 *   already complete before this script does anything: every route line and
 *   every stop lives in the vector tile bundle served from /tiles, and MapLibre
 *   draws them straight from the style. The React version had to ship all ~500
 *   stops and every route shape to the browser and re-render markers on each
 *   pan; here that is the renderer's job, over data it fetches by tile.
 *
 * What is left for this file:
 *
 *   - point MapLibre at the bundle, with the two style variants for light and
 *     dark following the site's own theme setting;
 *   - popups for stops, which link into the arrivals pages;
 *   - live vehicles, the one thing not in the tiles, as a GeoJSON source
 *     updated in place;
 *   - the nav menu, mirroring components/nav-menu.tsx.
 */

/** Where the tile bundle is served. See next.config.ts and nginx-tiles.conf. */
const TILES = "/tiles";
const VEHICLE_ENDPOINT = "/api/vehicle-positions";
const VEHICLE_INTERVAL_MS = 1000;
/** Shared with components/color-mode.tsx, so a theme choice carries across. */
const COLOR_MODE_KEY = "color-mode";
const START_CENTER = [-70.2864549, 43.6632339];
const START_ZOOM = 13;
/** Stops draw above vehicles: a bus must never hide the stop it is heading to. */
const STOPS_LAYER = "transit-stops-pie";

const errorBox = document.getElementById("map-error");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  console.error(message);
}

/* -------------------------------------------------------------- color mode */

function resolvedMode() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Flips to the opposite appearance, preferring "system" whenever that already
 * produces it — the same rule as toggleColorMode() in color-mode.tsx, so the
 * two pages cannot disagree about what the toggle does.
 */
function toggleColorMode() {
  const systemIsDark = window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches;
  const next =
    resolvedMode() === "light"
      ? systemIsDark
        ? "system"
        : "dark"
      : systemIsDark
        ? "light"
        : "system";

  try {
    if (next === "system") localStorage.removeItem(COLOR_MODE_KEY);
    else localStorage.setItem(COLOR_MODE_KEY, next);
  } catch {
    // Private browsing can throw; the current page still switches.
  }

  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
}

/* ------------------------------------------------------------------- style */

const styleBase = new URL(`${TILES}/`, window.location.href);

/**
 * MapLibre resolves relative URLs in a style against that style's own URL, but
 * only when handed the URL. We hand it a parsed object — the pmtiles:// source
 * URLs have to be rewritten first, and MapLibre does not resolve anything
 * behind a custom protocol — which leaves it no base, so every relative URL has
 * to be made absolute here.
 *
 * The glyphs template is the awkward one: new URL() percent-encodes the
 * {fontstack}/{range} braces, and MapLibre substitutes on the literal tokens,
 * so they have to survive the round trip intact.
 */
function absolute(relative) {
  return new URL(
    relative.replace(/\{/g, "%7B").replace(/\}/g, "%7D"),
    styleBase
  ).href
    .replace(/%7B/g, "{")
    .replace(/%7D/g, "}");
}

async function loadStyle(mode) {
  const file = mode === "dark" ? "style-dark.json" : "style.json";
  const response = await fetch(new URL(file, styleBase));
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const style = await response.json();

  style.sprite = absolute(style.sprite);
  style.glyphs = absolute(style.glyphs);
  for (const source of Object.values(style.sources)) {
    if (typeof source.url === "string" && source.url.startsWith("pmtiles://")) {
      source.url = `pmtiles://${absolute(source.url.slice("pmtiles://".length))}`;
    }
  }
  return style;
}

/* ------------------------------------------------------------ route colors */

/**
 * WCAG relative luminance, and the two rules the site draws from it. Ported
 * from lib/utils.ts — the popups have to pill routes exactly the way the
 * arrivals pages do, and this page cannot import from the bundle.
 */
function relativeLuminance(hexColor) {
  const hex = hexColor.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  const channel = (value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const r = channel(parseInt(full.substring(0, 2), 16) / 255);
  const g = channel(parseInt(full.substring(2, 4), 16) / 255);
  const b = channel(parseInt(full.substring(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever has the better contrast on this background. */
function contrastText(hexColor) {
  return relativeLuminance(hexColor) > 0.179 ? "#1a1a1a" : "#ffffff";
}

/** Very light routes need an outline or they vanish against the surface. */
function isTooLight(hexColor) {
  return relativeLuminance(hexColor) > 0.8;
}

/* ------------------------------------------------------------ stop popups */

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );
}

/** The tiles join these lists themselves; index i is one route across all three. */
function splitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pill(name, color, textColor) {
  const background = color || "#666666";
  const style = [
    `background-color:${background}`,
    `color:${textColor || contrastText(background)}`,
    `border-color:${isTooLight(background) ? "currentColor" : "transparent"}`,
  ].join(";");
  return `<span class="map-pill" style="${style}">${escapeHtml(name)}</span>`;
}

function stopPopupHtml(stop) {
  const names = splitList(stop.routes);
  const colors = splitList(stop.route_colors);
  const textColors = splitList(stop.route_text_colors);
  const pills = names
    .map((name, index) => pill(name, colors[index], textColors[index]))
    .join("");

  // A handful of stops in the feed carry no stop_code, and the arrivals pages
  // are addressed by code — so those get the identifying half of the popup
  // without a link that could not work.
  const code = stop.stop_code;

  return `
    <div class="map-popup">
      <h2 class="map-popup-name">${escapeHtml(stop.name || "Stop")}</h2>
      ${code ? `<div class="map-popup-code">Stop Number: ${escapeHtml(code)}</div>` : ""}
      ${pills ? `<div class="map-popup-routes">${pills}</div>` : ""}
      ${
        code
          ? `<a class="btn btn-primary map-popup-action" href="/stops/${encodeURIComponent(code)}">View Arrivals</a>`
          : ""
      }
    </div>
  `;
}

/* ---------------------------------------------------------- live vehicles */

const VEHICLE_SOURCE = "vehicles";
/** Logical size of the bearing arrow image, drawn for a 12 px dot. */
const ARROW_BOX = 48;
const ARROW_DOT = 12;

/** Route dot radius, following the old map's 10-24 px icons. */
const VEHICLE_RADIUS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  7,
  16,
  11,
  20,
  14,
];
/** Scales the arrow with the dot: the image is drawn for a radius of 12. */
const VEHICLE_ARROW_SIZE = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  7 / ARROW_DOT,
  16,
  11 / ARROW_DOT,
  20,
  14 / ARROW_DOT,
];

let vehicleData = { type: "FeatureCollection", features: [] };

/** Two-letter route names do not fit in the dot, so the long ones abbreviate. */
function vehicleLabel(routeShortName) {
  if (routeShortName === "HSK") return "H";
  if (routeShortName === "BRZ") return "B";
  return routeShortName;
}

function outlineColor() {
  return resolvedMode() === "dark" ? "#ffffff" : "#000000";
}

/**
 * An arrow in the route's own color, added to the style on demand.
 *
 * One image per color rather than a single recolorable SDF: an SDF would blur
 * a shape this small, and there are only ever as many colors as there are
 * routes. Style images do not survive setStyle(), so this is called again for
 * every visible color whenever the appearance changes.
 */
function ensureArrowImage(map, color) {
  const id = `vehicle-arrow-${color}`;
  if (map.hasImage(id)) return id;

  const ratio = 2;
  const size = ARROW_BOX * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  const center = size / 2;
  const radius = ARROW_DOT * ratio;
  context.beginPath();
  context.moveTo(center, center - radius - 10 * ratio);
  context.lineTo(center - 6 * ratio, center - radius);
  context.lineTo(center + 6 * ratio, center - radius);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  // Pale routes need the same outline the dot has, or the arrow disappears.
  context.lineWidth = ratio;
  context.strokeStyle = outlineColor();
  context.stroke();

  map.addImage(id, context.getImageData(0, 0, size, size), {
    pixelRatio: ratio,
  });
  return id;
}

function vehicleFeatures(map, positions) {
  return positions.map(({ position, bearing, route }) => {
    const color = route.routeColor || "#666666";
    const properties = {
      label: vehicleLabel(route.routeShortName),
      color,
      textColor: route.routeTextColor || contrastText(color),
    };
    // GTFS bearing is degrees clockwise from true north, which is exactly what
    // icon-rotate wants under map-aligned rotation. It is optional in the feed;
    // leaving the properties off entirely means no arrow is drawn.
    if (typeof bearing === "number") {
      properties.bearing = bearing;
      properties.arrow = ensureArrowImage(map, color);
    }
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [position.lng, position.lat],
      },
      properties,
    };
  });
}

/**
 * (Re)attach the vehicle source and layers. Runs on every style load, because
 * setStyle() replaces the whole style — sources, layers and images alike.
 */
function addVehicleLayers(map) {
  for (const feature of vehicleData.features) {
    if (feature.properties.arrow) {
      feature.properties.arrow = ensureArrowImage(
        map,
        feature.properties.color
      );
    }
  }

  map.addSource(VEHICLE_SOURCE, { type: "geojson", data: vehicleData });

  const before = map.getLayer(STOPS_LAYER) ? STOPS_LAYER : undefined;
  map.addLayer(
    {
      id: "vehicle-dot",
      type: "circle",
      source: VEHICLE_SOURCE,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": VEHICLE_RADIUS,
        "circle-stroke-width": 1,
        "circle-stroke-color": outlineColor(),
      },
    },
    before
  );
  map.addLayer(
    {
      id: "vehicle-label",
      type: "symbol",
      source: VEHICLE_SOURCE,
      layout: {
        "icon-image": ["get", "arrow"],
        // Vehicles with no bearing have no arrow either, but the expression is
        // still evaluated for them, and a null where a number belongs is an
        // error rather than a skipped icon.
        "icon-rotate": ["coalesce", ["get", "bearing"], 0],
        // The bearing is geographic, so the arrow turns with the map.
        "icon-rotation-alignment": "map",
        "icon-size": VEHICLE_ARROW_SIZE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          9,
          16,
          12,
          20,
          14,
        ],
        // These are positions, not labels: dropping one would misinform.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["get", "textColor"] },
    },
    before
  );
}

function startVehiclePolling(map) {
  let timer = null;
  let inFlight = false;

  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(VEHICLE_ENDPOINT, {
        // Without this the browser serves its own cached copy and the buses
        // never move. With it the response is still cached — by Last-Modified,
        // which is what the 304 below is answering.
        headers: { "Cache-Control": "no-cache" },
      });
      if (response.status === 304 || !response.ok) return;
      const positions = await response.json();

      // The source is attached on style load and gone again for the moment a
      // theme switch takes. Building features in that gap would mean adding
      // arrow images to a style that is about to be replaced.
      const source = map.getSource(VEHICLE_SOURCE);
      if (!source) return;

      vehicleData = {
        type: "FeatureCollection",
        features: vehicleFeatures(map, positions),
      };
      source.setData(vehicleData);
    } catch {
      // A dropped poll is not worth reporting: the next one is a second away.
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (timer !== null) return;
    poll();
    timer = window.setInterval(poll, VEHICLE_INTERVAL_MS);
  }

  function stop() {
    window.clearInterval(timer);
    timer = null;
  }

  // A backgrounded tab cannot show a moving bus, so it should not ask for one.
  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start()
  );
  start();
}

/* --------------------------------------------------------------------- map */

async function main() {
  // Teach MapLibre to read pmtiles:// URLs via HTTP range requests.
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);

  let mode = resolvedMode();
  const map = new maplibregl.Map({
    container: "map",
    style: await loadStyle(mode),
    center: START_CENTER,
    zoom: START_ZOOM,
    attributionControl: false,
  });
  window.map = map;

  // North-up, as the Leaflet map this replaces was: rotation buys nothing on a
  // transit map and is easy to trigger by accident on a phone.
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  // Bottom-left keeps the required OSM/OpenMapTiles/CARTO credit clear of the
  // nav menu in the opposite corner.
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-left"
  );

  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserLocation: true,
    fitBoundsOptions: { maxZoom: 16 },
  });
  map.addControl(geolocate, "top-right");

  map.on("error", (event) =>
    showError(`Map error: ${event?.error?.message || "unknown"}`)
  );

  map.on("style.load", () => addVehicleLayers(map));

  map.on("load", () => {
    // Waits for the style so the first poll has somewhere to put its features.
    startVehiclePolling(map);

    // Centering on the rider is the first thing the old map did once it had a
    // fix. The control answers its own capability check asynchronously, so
    // trigger() is a no-op until that lands — hence the few retries.
    if (!navigator.geolocation) return;
    let attempts = 0;
    const ask = () => {
      if (geolocate.trigger() || ++attempts > 10) return;
      window.setTimeout(ask, 150);
    };
    ask();
  });

  const popup = new maplibregl.Popup({ offset: 14, maxWidth: "none" });
  map.on("click", STOPS_LAYER, (event) => {
    const feature = event.features[0];
    popup
      // The stop's own position, not where the finger landed.
      .setLngLat(feature.geometry.coordinates)
      .setHTML(stopPopupHtml(feature.properties))
      .addTo(map);
  });
  map.on("mouseenter", STOPS_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", STOPS_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });

  // Swapping appearance is a whole new style: the basemap's palette is CARTO's,
  // so light and dark are two different documents rather than a repaint.
  function applyMode() {
    const next = resolvedMode();
    if (next === mode) return;
    mode = next;
    loadStyle(mode)
      .then((style) => map.setStyle(style))
      .catch((error) => showError(`Could not switch theme: ${error.message}`));
  }

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyMode);
  // Keeps other tabs in sync, as the React pages do.
  window.addEventListener("storage", applyMode);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    toggleColorMode();
    applyMode();
    closeNav();
  });
}

/* ---------------------------------------------------------------- nav menu */

const MENU_PATH = "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z";
const CLOSE_PATH =
  "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z";

const nav = document.getElementById("nav");
const navActions = document.getElementById("nav-menu-actions");
const navToggle = document.getElementById("nav-toggle");
const navFabPath = document.getElementById("nav-fab-path");

function setNavOpen(open) {
  nav.dataset.open = String(open);
  navToggle.setAttribute("aria-expanded", String(open));
  navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  navFabPath.setAttribute("d", open ? CLOSE_PATH : MENU_PATH);
  // The actions stay in the DOM so they can animate, but must not be reachable
  // by keyboard or screen reader while collapsed.
  navActions.inert = !open;
}

function closeNav() {
  setNavOpen(false);
}

navToggle.addEventListener("click", () =>
  setNavOpen(nav.dataset.open !== "true")
);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || nav.dataset.open !== "true") return;
  closeNav();
  navToggle.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (nav.dataset.open !== "true" || nav.contains(event.target)) return;
  closeNav();
});

main().catch((error) =>
  showError(`Could not load the map: ${error.message || error}`)
);
