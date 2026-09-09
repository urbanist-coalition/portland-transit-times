/**
 * @file Which service alerts apply, and when.
 *
 * Separate from alerts.js because that module touches the DOM the moment it is
 * imported, and these are the parts worth testing and worth sharing: the stop
 * page, and before long the TV board, have to agree about whether an alert is
 * in force, in the same way they already agree about whether a bus is late.
 *
 * A string-and-data module, like the renderers: no DOM, no browser globals, so
 * Node can import it. public/js/package.json is what lets it.
 */

/**
 * Whether `alert` is in force at `now`.
 *
 * GTFS-RT gives an alert a list of windows and lets either end of each one be
 * missing, and each absence means something specific: no `start` is "already in
 * force", no `end` is "until further notice". Several windows are alternatives,
 * so a roadworks alert can cover three weekends without claiming the weekdays
 * between them.
 *
 * No windows at all means always active — which is also what an alert written
 * by a worker from before any of this was retained looks like, since its JSON
 * has no activePeriod at all. That is the safe way round: the failure is an
 * alert shown a little too long, not a rider never told their stop is closed.
 */
export function isActive(alert, now) {
  const windows = alert?.activePeriod;
  if (!Array.isArray(windows) || windows.length === 0) return true;

  return windows.some(
    ({ start, end }) =>
      (start == null || now >= start) && (end == null || now <= end)
  );
}

/** The alerts worth showing at `now`, in the order the feed gave them. */
export function activeAlerts(alerts, now = Date.now()) {
  return (Array.isArray(alerts) ? alerts : []).filter((alert) =>
    isActive(alert, now)
  );
}

/**
 * Whether one GTFS-RT selector can be satisfied by a stop.
 *
 * A selector ANDs every field it sets, so this has to hold for all of them:
 * `{ routeId: "5", stopId: "0:1117" }` is route 5 *at* that stop, and matches
 * neither route 5 elsewhere nor the other routes there.
 *
 * The fields a stop cannot answer — a route type, a direction, a single trip —
 * are treated as satisfied rather than as a mismatch. This is the whole safety
 * property of the filter and it is deliberately lopsided: an alert can only be
 * hidden here by a selector that names a *different* stop or route, never by
 * one this code merely failed to understand. The cost is that an alert aimed
 * at one trip shows at every stop it might touch. The alternative is a rider
 * never being told their stop is closed, which is not a trade worth making.
 */
function selectorMatches(selector, stop) {
  if (!selector || typeof selector !== "object") return false;

  if (selector.stopId != null && selector.stopId !== stop.stopId) return false;
  if (
    selector.routeId != null &&
    !(stop.routeIds ?? []).includes(selector.routeId)
  ) {
    return false;
  }

  // agencyId, routeType, directionId and tripId: nothing here contradicts them.
  return true;
}

/**
 * Whether `alert` concerns `stop`, which is `{ stopId, routeIds }`.
 *
 * An alert ORs its selectors, so any one of them matching is enough. No
 * selectors at all means the feed did not say what the alert is about, which
 * has to read as "everything" — the producer is free to omit it, and an alert
 * nobody scoped is not an alert nobody needs.
 */
export function appliesToStop(alert, stop) {
  const selectors = alert?.informedEntity;
  if (!Array.isArray(selectors) || selectors.length === 0) return true;

  return selectors.some((selector) => selectorMatches(selector, stop));
}

/**
 * How loudly to say it. Higher is louder; an alert the feed said nothing about
 * sits with the ordinary ones rather than at either extreme.
 */
const SEVERITY_RANK = { severe: 3, warning: 2, info: 1, unknown: 1 };

export function severityRank(alert) {
  return SEVERITY_RANK[alert?.severity] ?? 1;
}

/**
 * The alerts a stop should show, worst first.
 *
 * Sorted rather than left in feed order because the surfaces that can only
 * show one — a board on a wall — have to be able to take the first and know it
 * is the one that matters. A stable sort keeps the feed's order within a
 * severity, so equally urgent alerts do not shuffle between polls.
 */
export function alertsForStop(alerts, stop, now = Date.now()) {
  return activeAlerts(alerts, now)
    .filter((alert) => appliesToStop(alert, stop))
    .sort((a, b) => severityRank(b) - severityRank(a));
}
