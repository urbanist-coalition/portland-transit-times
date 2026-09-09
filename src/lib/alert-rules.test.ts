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

import { activeAlerts, isActive } from "../../public/js/alert-rules.js";

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
