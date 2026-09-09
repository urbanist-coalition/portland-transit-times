/**
 * @file When a service alert is in force.
 *
 * Every case here is an absence meaning something. GTFS-RT lets either end of
 * an active window be missing and lets the list of windows be missing too, and
 * each of those is a different statement — "already started", "no end
 * announced", "always". Read as a plain range check they all collapse into
 * "not active", which would hide exactly the alerts that matter most: the ones
 * with no end date.
 */

import {
  activeAlerts,
  alertsForStop,
  appliesToStop,
  isActive,
} from "../../public/js/alert-rules.js";

const now = Date.UTC(2026, 8, 9, 12, 0);
const hours = (count: number) => now + count * 3_600_000;

const alert = (activePeriod: unknown) => ({
  id: "a",
  headerText: "Elevator out of service",
  descriptionText: "Use the ramp",
  activePeriod,
});

describe("isActive()", () => {
  it("treats an alert with no windows as always in force", () => {
    expect(isActive(alert([]), now)).toBe(true);
  });

  it("treats an alert from before any of this was retained as in force", () => {
    // An alerts.json written by the old worker has no activePeriod at all, and
    // the site serves the last release's copy until the worker rewrites it.
    expect(isActive({ id: "a", headerText: "h" }, now)).toBe(true);
  });

  it("is in force inside a window", () => {
    expect(isActive(alert([{ start: hours(-1), end: hours(1) }]), now)).toBe(
      true
    );
  });

  it("is not in force before it starts", () => {
    expect(isActive(alert([{ start: hours(1), end: hours(2) }]), now)).toBe(
      false
    );
  });

  it("is not in force after it ends", () => {
    expect(isActive(alert([{ start: hours(-2), end: hours(-1) }]), now)).toBe(
      false
    );
  });

  it("reads a missing start as already begun", () => {
    expect(isActive(alert([{ end: hours(1) }]), now)).toBe(true);
    expect(isActive(alert([{ end: hours(-1) }]), now)).toBe(false);
  });

  it("reads a missing end as until further notice", () => {
    // The case that matters most: an open-ended alert is the one nobody has
    // been able to put a date on, which is rarely the trivial one.
    expect(isActive(alert([{ start: hours(-1) }]), now)).toBe(true);
    expect(isActive(alert([{ start: hours(1) }]), now)).toBe(false);
  });

  it("takes several windows as alternatives", () => {
    // Three weekends of roadworks, and this is the Tuesday in between.
    const weekends = alert([
      { start: hours(-100), end: hours(-90) },
      { start: hours(-1), end: hours(1) },
      { start: hours(90), end: hours(100) },
    ]);
    expect(isActive(weekends, now)).toBe(true);

    expect(
      isActive(
        alert([
          { start: hours(-100), end: hours(-90) },
          { start: hours(90), end: hours(100) },
        ]),
        now
      )
    ).toBe(false);
  });

  it("counts an instant on either boundary as in force", () => {
    expect(isActive(alert([{ start: now, end: hours(1) }]), now)).toBe(true);
    expect(isActive(alert([{ start: hours(-1), end: now }]), now)).toBe(true);
  });
});

describe("activeAlerts()", () => {
  it("keeps the feed's order and drops only what has lapsed", () => {
    const alerts = [
      { ...alert([{ start: hours(-1) }]), id: "open-ended" },
      { ...alert([{ start: hours(-2), end: hours(-1) }]), id: "over" },
      { ...alert([]), id: "always" },
      { ...alert([{ start: hours(2) }]), id: "not-yet" },
    ];

    expect(activeAlerts(alerts, now).map((a) => a.id)).toEqual([
      "open-ended",
      "always",
    ]);
  });

  it("survives a body that is not a list", () => {
    // The fetch is unguarded beyond `response.ok`, and a proxy error page is
    // not an array.
    expect(activeAlerts(null, now)).toEqual([]);
    expect(activeAlerts(undefined, now)).toEqual([]);
    expect(activeAlerts({ error: "nope" }, now)).toEqual([]);
  });
});

const stop = { stopId: "0:1117", routeIds: ["1", "5", "8"] };

const targeted = (informedEntity: unknown, extra: object = {}) => ({
  id: "a",
  headerText: "Stop closed",
  descriptionText: "Use Congress St + High St",
  informedEntity,
  ...extra,
});

describe("appliesToStop()", () => {
  it("shows an alert the feed did not scope", () => {
    // A producer may omit informed_entity entirely. That is not "affects
    // nothing" — it is the agency not saying, and a rider still needs it.
    expect(appliesToStop(targeted([]), stop)).toBe(true);
    expect(appliesToStop({ id: "a", headerText: "h" }, stop)).toBe(true);
  });

  it("matches a selector naming this stop", () => {
    expect(appliesToStop(targeted([{ stopId: "0:1117" }]), stop)).toBe(true);
  });

  it("does not match a selector naming a different stop", () => {
    expect(appliesToStop(targeted([{ stopId: "0:1131" }]), stop)).toBe(false);
  });

  it("matches a route this stop is served by", () => {
    expect(appliesToStop(targeted([{ routeId: "5" }]), stop)).toBe(true);
    expect(appliesToStop(targeted([{ routeId: "24A" }]), stop)).toBe(false);
  });

  it("ANDs the fields within one selector", () => {
    // Route 5 *at* this stop, which is neither route 5 elsewhere nor the
    // other routes here.
    const here = targeted([{ routeId: "5", stopId: "0:1117" }]);
    expect(appliesToStop(here, stop)).toBe(true);

    const elsewhere = targeted([{ routeId: "5", stopId: "0:1131" }]);
    expect(appliesToStop(elsewhere, stop)).toBe(false);

    const otherRouteHere = targeted([{ routeId: "24A", stopId: "0:1117" }]);
    expect(appliesToStop(otherRouteHere, stop)).toBe(false);
  });

  it("ORs the selectors", () => {
    const either = targeted([{ stopId: "0:1131" }, { routeId: "8" }]);
    expect(appliesToStop(either, stop)).toBe(true);
  });

  it("shows an agency-wide alert", () => {
    expect(appliesToStop(targeted([{ agencyId: "GPTD" }]), stop)).toBe(true);
  });

  it("shows an alert scoped only by things a stop cannot answer", () => {
    // Deliberately lopsided: a stop knows nothing about directions or single
    // trips, and failing open means an extra line rather than a rider never
    // being told. See selectorMatches.
    expect(appliesToStop(targeted([{ directionId: 0 }]), stop)).toBe(true);
    expect(appliesToStop(targeted([{ tripId: "Saturday915070" }]), stop)).toBe(
      true
    );
    expect(appliesToStop(targeted([{ routeType: 3 }]), stop)).toBe(true);
  });

  it("can only be hidden by an explicit mismatch", () => {
    // The safety property, stated directly: of every selector shape, the only
    // ones that hide an alert here name a stop or a route that is not ours.
    const shapes = [
      [{}],
      [{ agencyId: "GPTD" }],
      [{ routeType: 3 }],
      [{ directionId: 1 }],
      [{ tripId: "t" }],
      [{ stopId: "0:1117" }],
      [{ routeId: "1" }],
    ];
    for (const informedEntity of shapes) {
      expect(appliesToStop(targeted(informedEntity), stop)).toBe(true);
    }
  });
});

describe("alertsForStop()", () => {
  it("puts the worst first and keeps feed order within a severity", () => {
    const alerts = [
      targeted([], { id: "info-1", severity: "info" }),
      targeted([], { id: "severe", severity: "severe" }),
      targeted([], { id: "info-2", severity: "info" }),
      targeted([], { id: "warning", severity: "warning" }),
    ];

    expect(alertsForStop(alerts, stop, now).map((a) => a.id)).toEqual([
      "severe",
      "warning",
      "info-1",
      "info-2",
    ]);
  });

  it("ranks an unstated severity with the ordinary ones", () => {
    // Not at either extreme: a feed that said nothing has not said it is
    // urgent, and has not said it is trivial either.
    const alerts = [
      targeted([], { id: "unsaid" }),
      targeted([], { id: "warning", severity: "warning" }),
    ];

    expect(alertsForStop(alerts, stop, now).map((a) => a.id)).toEqual([
      "warning",
      "unsaid",
    ]);
  });

  it("applies the clock and the targeting together", () => {
    const alerts = [
      targeted([{ stopId: "0:1131" }], { id: "elsewhere" }),
      targeted([{ stopId: "0:1117" }], {
        id: "lapsed",
        activePeriod: [{ start: hours(-2), end: hours(-1) }],
      }),
      targeted([{ stopId: "0:1117" }], { id: "here-and-now" }),
    ];

    expect(alertsForStop(alerts, stop, now).map((a) => a.id)).toEqual([
      "here-and-now",
    ]);
  });
});
