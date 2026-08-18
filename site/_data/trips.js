/**
 * Every trip, read from the release's static feed.
 *
 * A trip page is the timetable for one run of one bus: the stops it calls at,
 * in order, and the time it is due at each. All of that is a property of the
 * feed — it is the same on every day the trip runs — so like the stop pages it
 * belongs in the HTML rather than in a payload every visitor downloads.
 *
 * The times here are clock readings with no date attached, which is what lets
 * one page serve every day the trip runs. Only a *running* of the trip has
 * instants, and those arrive later, from the worker.
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_PATH = join(__dirname, "..", "..", "_data", "static.json");

const DAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/**
 * Which days of the week a service runs, from the dates the feed grants it.
 *
 * A trip page has no date on it — that is what lets one page serve every day
 * the trip runs — so without this it would show a rider a timetable with no
 * hint that it is Sunday's, on a Wednesday. The days are read back off the
 * calendar rather than from the service's name, which in this feed is "No
 * School" and means nothing to anyone standing at a stop.
 */
function serviceDays(dates) {
  if (!dates || dates.length === 0) return "";

  const days = new Set();
  for (const date of dates) {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    days.add(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
  }

  const ordered = [...days].sort((a, b) => a - b);
  if (ordered.length === 1) return DAY_NAMES[ordered[0]];

  const contiguous = ordered.every(
    (day, index) => index === 0 || day === ordered[index - 1] + 1
  );
  return contiguous
    ? `${DAY_NAMES[ordered[0]]} to ${DAY_NAMES[ordered[ordered.length - 1]]}`
    : ordered.map((day) => DAY_NAMES[day]).join(", ");
}

module.exports = function trips() {
  const path = process.env.STATIC_FEED || DEFAULT_PATH;

  let feed;
  try {
    feed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // The same flag the stop pages use: CI proves the templates compile
    // without a feed, and neither set of pages can be built without one.
    if (process.env.SKIP_STOPS) {
      console.log("[trips] SKIP_STOPS set — building without trip pages");
      return [];
    }
    throw new Error(
      `No static feed at ${path} — run the worker to write one, or set ` +
        `SKIP_STOPS=1 to build without trip pages. (${error.message})`
    );
  }

  const stopsById = new Map(feed.stops.map((stop) => [stop.stopId, stop]));
  const routesById = new Map(feed.routes.map((route) => [route.routeId, route]));
  const daysByService = new Map(
    Object.entries(feed.serviceDates || {}).map(([serviceId, dates]) => [
      serviceId,
      serviceDays(dates),
    ])
  );

  const callsByTrip = new Map();
  for (const call of feed.calls) {
    const forTrip = callsByTrip.get(call.tripId) || [];
    forTrip.push(call);
    callsByTrip.set(call.tripId, forTrip);
  }

  const usable = [];
  for (const trip of feed.trips) {
    const route = routesById.get(trip.routeId);
    const calls = (callsByTrip.get(trip.tripId) || [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((call) => {
        const stop = stopsById.get(call.stopId);
        return {
          stopId: call.stopId,
          sequence: call.sequence,
          time: call.time,
          // A stop the feed gives no code has no page to link to. There are
          // none in this feed; a row without a link is what happens if that
          // changes, rather than a link to /stops//.
          stopCode: stop?.stopCode || "",
          stopName: stop?.stopName || "This stop",
        };
      });

    // A trip with no route has no colour and no name to show, and a trip with
    // no calls is a page that says nothing. Neither exists in this feed.
    if (!route || calls.length === 0) continue;

    usable.push({
      tripId: trip.tripId,
      headsign: trip.tripHeadsign,
      serviceId: trip.serviceId,
      runs: daysByService.get(trip.serviceId) || "",
      route,
      calls,
      startTime: calls[0].time,
      endTime: calls[calls.length - 1].time,
    });
  }

  console.log(`[trips] ${usable.length} trips from ${path}`);
  return usable;
};
