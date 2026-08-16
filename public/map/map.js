/**
 * @file The map page.
 *
 * There is no framework here, and no state to keep in sync, because the map is
 *   already complete before this script does anything: every route line and
 *   every stop lives in the vector tile bundle served from /tiles, and MapLibre
 *   draws them straight from the style. The browser fetches only the tiles for
 *   what it is looking at, so panning and zooming cost a tile request rather
 *   than a re-render, and nothing here holds the ~500 stops in memory at all.
 *
 * What is left for this file:
 *
 *   - point MapLibre at the bundle, with the two style variants for light and
 *     dark following the site's own theme setting;
 *   - popups for stops, which link into the arrivals pages;
 *   - live vehicles, the one thing not in the tiles, as a GeoJSON source
 *     updated in place.
 *
 * The nav menu and the theme toggle are the site's, from /js/nav.js and
 * /js/theme.js. This page is only unusual in caring what the theme *is*: its
 * appearance is a different style document, not a different palette.
 */

import { contrastText, isTooLight } from "/js/colors.js";
import { compareRouteNames } from "/js/routes.js";
import { onModeChange, resolvedMode } from "/js/theme.js";

/** Where the tile bundle is served: the current release's, via nginx-site.conf. */
const TILES = "/tiles";
/** Written by the worker every second, like everything else the site polls. */
const VEHICLE_ENDPOINT = "/data/vehicle-positions.json";
const VEHICLE_INTERVAL_MS = 1000;
const START_CENTER = [-70.2864549, 43.6632339];
const START_ZOOM = 13;
/** The stop markers: what a tap on a stop hits. Topmost layer in the style. */
const STOPS_LAYER = "transit-stops-pie";
/**
 * Vehicles go directly under the stop markers, which is the top of the style —
 * so a bus covers street names and stop names rather than being cut up by them.
 * A bus is the one thing on this map that is only true for a second, and a
 * label it happens to sit under is not worth losing it to.
 *
 * The stop markers stay above: a bus must never hide the stop it is heading to.
 */
const VEHICLE_INSERT_BEFORE = STOPS_LAYER;

const errorBox = document.getElementById("map-error");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  console.error(message);
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

  // The three lists are parallel, so they are zipped before sorting or the
  // colours would come away from their routes.
  const pills = names
    .map((name, index) => ({
      name,
      color: colors[index],
      textColor: textColors[index],
    }))
    .sort((a, b) => compareRouteNames(a.name, b.name))
    .map(({ name, color, textColor }) => pill(name, color, textColor))
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
          ? `<a class="btn btn-primary map-popup-action" href="/stops/${encodeURIComponent(code)}/">View Arrivals</a>`
          : ""
      }
    </div>
  `;
}

/* ---------------------------------------------------------- live vehicles */

const VEHICLE_SOURCE = "vehicles";
/**
 * The badge is drawn once per route, heading and appearance at this reference
 * radius, then scaled by icon-size. The box has to hold the badge at every
 * heading, so it is sized off the nose — the furthest any part of the shape
 * gets from the center it turns around — with room for the casing.
 */
const BADGE_RADIUS = 10;
const BADGE_BOX = 46;
/** Route number size inside that badge, before icon-size scales the image. */
const BADGE_TEXT = 11;

/**
 * The heading is baked into the image rather than applied with icon-rotate, so
 * it has to be quantized: 24 steps, 15 degrees each, at most 7.5 degrees from
 * the reported bearing. That is finer than the feed's own bearings are stable,
 * and on a shape this blunt it is not a difference anyone can see.
 *
 * It also bounds what this costs. A badge exists per route per step — twelve
 * routes and a round badge for the bearingless, so at most a few hundred small
 * images, reached only if every bus is seen at every heading.
 */
const BEARING_STEPS = 24;

/**
 * Where the number appears — the zoom the route numbers along the lines come
 * in at, so the map starts naming routes in both places at once rather than
 * having buses labelled while the lines they run on are still anonymous. It is
 * transit-route-labels' minzoom in tiles/make_style.py; if that moves, this
 * follows it.
 *
 * Below it the badge is drawn without a number: at a city-wide view that is
 * three or four pixels of ink resolving into a smudge, and a smudge on every
 * bus is worse than none. The arrow still says where the buses are and which
 * way they are going, which is what that view is for.
 *
 * Baked-in text means this is a different image rather than a text layer being
 * hidden, so both are drawn: at most twice the badges, still a few hundred.
 */
const LABEL_ZOOM = 13;

/**
 * Scales the badge by the size its number comes out at — 9.5 px where the
 * number arrives, 11 at the street — and below that by how small a bare arrow
 * can get and still read: a third of full size at the city scale, where the
 * marker's whole job is "a bus is here, going that way".
 *
 * The badge grows most of the way to full size across the single zoom level
 * below LABEL_ZOOM, and barely at all above it. That is what pulling the
 * number earlier costs: a number is only worth drawing at a size someone can
 * read, and the badge is built around the number, so the two arrive together.
 * The alternative was labelling buses while the badge was still a dart.
 *
 * This is the dial for the marker's size, since everything in the badge is
 * proportional to its number.
 */
const VEHICLE_ICON_SIZE = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  4 / BADGE_TEXT,
  LABEL_ZOOM,
  9.5 / BADGE_TEXT,
  16,
  11 / BADGE_TEXT,
  20,
  12.5 / BADGE_TEXT,
];

let vehicleData = { type: "FeatureCollection", features: [] };

/** Two-letter route names do not fit in the badge, so the long ones abbreviate. */
function vehicleLabel(routeShortName) {
  if (routeShortName === "HSK") return "H";
  if (routeShortName === "BRZ") return "B";
  return routeShortName;
}

/**
 * The ring around the badge, in the basemap's own background color.
 *
 * A bus sits on the line it is running, in that line's color, so a badge with
 * no ring has nothing to separate it from what it stands on. The ring reads as
 * a gap in the line rather than as a stroke around the badge, which is why it
 * is the background color and not an ink.
 */
function casingColor() {
  return resolvedMode() === "dark" ? "#0e0e0e" : "#ffffff";
}

/** Traces a polygon with every corner rounded by the same radius. */
function roundedPoly(context, points, radius) {
  const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = midpoint(points[points.length - 1], points[0]);
  context.beginPath();
  context.moveTo(start[0], start[1]);
  for (let i = 0; i < points.length; i += 1) {
    const corner = points[i];
    const next = midpoint(corner, points[(i + 1) % points.length]);
    context.arcTo(corner[0], corner[1], next[0], next[1], radius);
    context.lineTo(next[0], next[1]);
  }
  context.closePath();
}

/**
 * The whole marker — badge, heading and route number — as one image, added to
 * the style on demand.
 *
 * Nose forward, stern flat. The flat back is the point of the shape: anything
 * that tapers behind reads as a comet tail, and a comet's tail points where it
 * came *from* — riders reported buses looking like they ran backwards. A blunt
 * stern has no such second reading.
 *
 * The number is drawn into the image rather than left to a text layer, and that
 * is what fixes the interleaving. A symbol layer draws every icon and then
 * every label, in two passes, so one bus's number lands on top of another bus's
 * badge even when that badge is on top: overlapping markers came apart into
 * their pieces. One image per bus means the stack is decided per bus.
 *
 * The badge hangs off the anchor rather than being centered on it: the number
 * sits at 0,0 with the nose ahead of it and the stern behind, so a bus's
 * position is where its number is, and the digits stay centered at every
 * heading rather than swinging towards the nose.
 *
 * A drawn image rather than a recolorable SDF: an SDF would blur a shape this
 * small. Style images do not survive setStyle(), so every visible badge is
 * drawn again whenever the appearance changes — which is also what repaints the
 * casing in the new theme's color.
 */
function ensureBadgeImage(map, { label, color, textColor, bearing }, numbered) {
  const step =
    typeof bearing === "number"
      ? ((Math.round(bearing / (360 / BEARING_STEPS)) % BEARING_STEPS) +
          BEARING_STEPS) %
        BEARING_STEPS
      : null;
  const id = `vehicle-${color}-${numbered ? label : "plain"}-${
    step === null ? "flat" : step
  }`;
  if (map.hasImage(id)) return id;

  const ratio = 2;
  const size = BADGE_BOX * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.translate(size / 2, size / 2);
  context.scale(ratio, ratio);

  const r = BADGE_RADIUS;
  context.save();
  if (step === null) {
    // The feed leaves bearing out for some vehicles. Rather than point a nose
    // in a direction nobody reported, those keep a round badge.
    context.beginPath();
    context.arc(0, 0, r * 1.1, 0, Math.PI * 2);
  } else {
    // GTFS bearing is degrees clockwise from true north, and the badge is drawn
    // nose-up, so the step is the rotation. It bakes in, which means the badge
    // no longer turns with the map — but neither does a bus's heading.
    context.rotate((step * (360 / BEARING_STEPS) * Math.PI) / 180);
    // A square holding the number, with the same triangle on both ends: one
    // pointing out at the nose, one cut back in at the stern. Matching them
    // makes the shape read as a single arrow rather than a badge with things
    // added to it, and the notch is the second thing saying which end is which
    // — a tail cut inwards is how every arrow ever drawn ends.
    //
    // The triangles are as deep as the square is wide, a 90 degree nose. The
    // sharper the point, the more the shape narrows where the number needs to
    // be, and this is a shape that has to hold "24A" at 8 px.
    const w = 1.1 * r;
    roundedPoly(
      context,
      [
        [0, -2 * w],
        [w, -w],
        [w, 2 * w],
        [0, w],
        [-w, 2 * w],
        [-w, -w],
      ],
      0.28 * r
    );
  }
  context.fillStyle = color;
  context.fill();
  context.lineJoin = "round";
  context.lineWidth = 2;
  context.strokeStyle = casingColor();
  context.stroke();
  context.restore();

  if (numbered) {
    // Upright whatever the badge is doing, in the site's own face rather than
    // the map's: this is drawn by the browser, not set in glyphs like the stop
    // names are.
    context.font = `700 ${BADGE_TEXT}px ${getComputedStyle(document.body).fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = textColor;
    context.fillText(label, 0, 0.5);
  }

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
      // Optional in the feed. A vehicle without one keeps the round badge, so
      // the property is carried through as-is rather than defaulted.
      bearing: typeof bearing === "number" ? bearing : null,
    };
    properties.badge = ensureBadgeImage(map, properties, true);
    properties.badgePlain = ensureBadgeImage(map, properties, false);
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
    feature.properties.badge = ensureBadgeImage(map, feature.properties, true);
    feature.properties.badgePlain = ensureBadgeImage(
      map,
      feature.properties,
      false
    );
  }

  map.addSource(VEHICLE_SOURCE, { type: "geojson", data: vehicleData });

  const before = map.getLayer(VEHICLE_INSERT_BEFORE)
    ? VEHICLE_INSERT_BEFORE
    : undefined;
  map.addLayer(
    {
      id: "vehicle-badge",
      type: "symbol",
      source: VEHICLE_SOURCE,
      layout: {
        // The number is part of the image, so dropping it at low zoom means
        // swapping the image. Zoom outside, feature lookup inside: that is the
        // one nesting order MapLibre allows for a layout property.
        "icon-image": [
          "step",
          ["zoom"],
          ["get", "badgePlain"],
          LABEL_ZOOM,
          ["get", "badge"],
        ],
        "icon-size": VEHICLE_ICON_SIZE,
        // These are positions, not labels: dropping one would misinform.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // One icon per bus and no text of its own, so two overlapping buses
        // stack whole. Under allow-overlap the default order is by viewport
        // position, which is stable frame to frame — buses do not swap places
        // in the stack while standing still.
      },
    },
    before
  );
}

function startVehiclePolling(map) {
  let timer = null;
  let inFlight = false;
  let succeeded = false;

  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(VEHICLE_ENDPOINT, {
        // Without this the browser serves its own cached copy and the buses
        // never move. nginx still answers most of these with a 304 from the
        // file's mtime, which is the cheap part.
        cache: "no-store",
      });
      if (response.status === 304) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const positions = await response.json();

      // The source is attached on style load and gone again for the moment a
      // theme switch takes. Building features in that gap would mean adding
      // badge images to a style that is about to be replaced.
      const source = map.getSource(VEHICLE_SOURCE);
      if (!source) return;

      vehicleData = {
        type: "FeatureCollection",
        features: vehicleFeatures(map, positions),
      };
      source.setData(vehicleData);
      succeeded = true;
    } catch (error) {
      // A dropped poll is not worth reporting — the next one is a second away
      // — but a feed that has never arrived is, because no buses and a broken
      // feed look exactly the same on the map.
      console.error("vehicle poll failed:", error);
      if (!succeeded) showError(`Live buses unavailable: ${error.message}`);
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

    // Centering on the rider is the first thing this page should do once it
    // has a fix. The control answers its own capability check asynchronously,
    // so trigger() is a no-op until that lands — hence the few retries.
    if (!navigator.geolocation) return;
    let attempts = 0;
    const ask = () => {
      if (geolocate.trigger() || ++attempts > 10) return;
      window.setTimeout(ask, 150);
    };
    ask();
  });

  const popup = new maplibregl.Popup({
    offset: 14,
    // A stop on a shared corridor carries a dozen routes, and unbounded they
    // ran off the side of the screen. Capped, the pills wrap down the page
    // instead — of which there is plenty, since the popup sits over a map.
    maxWidth: "17rem",
    // Tapping the map dismisses it, which is what a finger does anyway.
    closeButton: false,
  });
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

  // Fires for our own toggle, the OS preference, and other tabs alike.
  onModeChange(applyMode);
}

main().catch((error) =>
  showError(`Could not load the map: ${error.message || error}`)
);
