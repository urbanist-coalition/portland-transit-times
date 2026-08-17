/**
 * @file The one step that depends on what time it is.
 *
 * The window used to be an emergent property of `differenceInDays(date, now)`,
 * which truncates — so how far the app looked ahead depended on the hour the
 * feed happened to load, and no test could state what it was testing. It is a
 * parameter now, and these say what it does.
 */

import { Route, Trip } from "@/types";

import { datesInWindow, departuresAfter, expandInstances } from "./expand";
import { StaticFeed } from "./types";

const TIME_ZONE = "America/New_York";

const route: Route = {
  routeId: "r1",
  routeShortName: "5",
  routeColor: "#00B050",
  routeTextColor: "#FFFFFF",
};

const trip: Trip = {
  tripId: "t1",
  routeId: "r1",
  serviceId: "weekday",
  shapeId: "s1",
  tripHeadsign: "City Hall",
};

const feed = (overrides: Partial<StaticFeed> = {}): StaticFeed => ({
  feedHash: "test",
  routes: [route],
  trips: [trip],
  stops: [],
  calls: [
    { tripId: "t1", stopId: "0:1", sequence: 1, time: "10:00:00" },
    { tripId: "t1", stopId: "0:2", sequence: 2, time: "10:30:00" },
  ],
  serviceDates: { weekday: ["20260817", "20260818", "20260819", "20260825"] },
  ...overrides,
});

/** Noon on 2026-08-17, in the agency's zone. */
const noon = new Date("2026-08-17T16:00:00Z").getTime();

describe("datesInWindow()", () => {
  it("is the same set whatever time of day it is asked", () => {
    const morning = new Date("2026-08-17T11:00:00Z").getTime();
    const evening = new Date("2026-08-17T23:00:00Z").getTime();
    const window = { back: 1, forward: 3 };

    expect([...datesInWindow(morning, window)].sort()).toEqual(
      [...datesInWindow(evening, window)].sort()
    );
  });

  it("spans back through forward, inclusive of today", () => {
    expect([...datesInWindow(noon, { back: 1, forward: 2 })].sort()).toEqual([
      "20260816",
      "20260817",
      "20260818",
      "20260819",
    ]);
  });
});

describe("expandInstances()", () => {
  it("crosses the schedule with the dates its service runs", () => {
    const byStop = expandInstances(feed(), noon, TIME_ZONE, {
      back: 0,
      forward: 2,
    });

    // Three dates are in range; the fourth, the 25th, is not.
    expect(byStop.get("0:1")).toHaveLength(3);
    expect(byStop.get("0:1")!.map((instance) => instance.serviceDate)).toEqual([
      "20260817",
      "20260818",
      "20260819",
    ]);
  });

  it("gives each departure an absolute time in the agency's zone", () => {
    const [first] = expandInstances(feed(), noon, TIME_ZONE, {
      back: 0,
      forward: 0,
    }).get("0:1")!;

    // 10:00 in Portland on that date is 14:00 UTC.
    expect(new Date(first!.scheduledTime).toISOString()).toBe(
      "2026-08-17T14:00:00.000Z"
    );
  });

  it("handles a trip that runs past midnight", () => {
    const late = feed({
      calls: [{ tripId: "t1", stopId: "0:1", sequence: 1, time: "25:30:00" }],
    });

    const [instance] = expandInstances(late, noon, TIME_ZONE, {
      back: 0,
      forward: 0,
    }).get("0:1")!;

    // 25:30 on the 17th is 01:30 on the 18th, still the 17th's service.
    expect(instance!.serviceDate).toBe("20260817");
    expect(new Date(instance!.scheduledTime).toISOString()).toBe(
      "2026-08-18T05:30:00.000Z"
    );
  });

  it("sorts a stop's departures by time", () => {
    const byStop = expandInstances(feed(), noon, TIME_ZONE, {
      back: 0,
      forward: 2,
    });
    const times = byStop.get("0:2")!.map((instance) => instance.scheduledTime);

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("carries the terminating flag through to the departure", () => {
    const ending = feed({
      calls: [
        {
          tripId: "t1",
          stopId: "0:2",
          sequence: 2,
          time: "10:30:00",
          terminates: true,
        },
      ],
    });

    const [instance] = expandInstances(ending, noon, TIME_ZONE, {
      back: 0,
      forward: 0,
    }).get("0:2")!;

    expect(instance!.terminates).toBe(true);
  });
});

describe("departuresAfter()", () => {
  const instances = [10, 20, 30, 40, 50].map((minute) => ({
    serviceDate: "20260817",
    tripId: `t${minute}`,
    stopId: "0:1",
    scheduledTime: minute,
    route,
    trip,
  }));

  it("finds the first departure at or after the cutoff", () => {
    expect(
      departuresAfter(instances, 25, 2).map((i) => i.scheduledTime)
    ).toEqual([30, 40]);
  });

  it("includes a departure exactly on the cutoff", () => {
    expect(departuresAfter(instances, 30, 1)[0]!.scheduledTime).toBe(30);
  });

  it("returns nothing once the cutoff is past the last one", () => {
    expect(departuresAfter(instances, 60, 5)).toEqual([]);
  });

  it("returns everything left when fewer remain than asked for", () => {
    expect(departuresAfter(instances, 45, 40)).toHaveLength(1);
  });
});
