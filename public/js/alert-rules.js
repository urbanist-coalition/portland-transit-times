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
