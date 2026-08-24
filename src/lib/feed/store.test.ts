/**
 * @file Whether a bus has left, which only the vehicle feed can say.
 *
 * The trip updates cannot be read for it. While a bus stands at a stop this
 * agency reports the arrival it has already made and moves the departure to
 * whenever the feed was built, so both times are behind the clock for the whole
 * layover — and a stop page that took that for a departure told riders the bus
 * had gone while it was sitting in front of them.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Route, StopTimeStatus, Trip, VehicleProgress } from "@/types";

import { ARRIVALS_LIMIT } from "./expand";
import { TransitStore } from "./store";
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
  tripHeadsign: "USM Campus Gorham",
};

/** Hancock St + Thames St, where the trip starts, and the stop after it. */
const feed: StaticFeed = {
  feedHash: "test",
  routes: [route],
  trips: [trip],
  stops: [
    {
      stopId: "0:111",
      stopCode: "111",
      stopName: "Hancock St + Thames St",
      location: { lat: 43.65, lng: -70.25 },
      routes: [route],
    },
    {
      stopId: "0:101",
      stopCode: "101",
      stopName: "Ocean Ave",
      location: { lat: 43.66, lng: -70.26 },
      routes: [route],
    },
  ],
  calls: [
    { tripId: "t1", stopId: "0:111", sequence: 1, time: "10:00:00" },
    { tripId: "t1", stopId: "0:101", sequence: 2, time: "10:10:00" },
  ],
  // Two runnings of the same trip, which is what a vehicle report has to be
  // pinned to one of.
  serviceDates: { weekday: ["20260817", "20260818"] },
};

/** 09:55 in Portland on the first of those days. */
const now = new Date("2026-08-17T13:55:00Z").getTime();
const scheduled = new Date("2026-08-17T14:00:00Z").getTime();
/** What the agency reports while the bus waits: the moment the feed was built. */
const dwelling = new Date("2026-08-17T13:53:00Z").getTime();

async function load(): Promise<TransitStore> {
  const directory = await mkdtemp(join(tmpdir(), "store-test-"));
  const path = join(directory, "static.json");
  await writeFile(path, JSON.stringify(feed));

  const store = new TransitStore(TIME_ZONE);
  await store.loadStatic(path, now);
  return store;
}

/** The prediction the agency publishes for a bus laying over at 0:111. */
function reportDwelling(store: TransitStore): void {
  store.setStopTimeUpdates(
    [
      {
        serviceDate: "20260817",
        tripId: "t1",
        stopId: "0:111",
        predictedTime: dwelling,
        status: StopTimeStatus.scheduled,
      },
    ],
    new Date(now)
  );
}

const atStop = (stopId: string, stopped: boolean): VehicleProgress[] => [
  { tripId: "t1", stopId, stopped },
];

/** The first departure this stop offers, whatever the store now says about it. */
const first = (store: TransitStore, stopId = "0:111") =>
  store.departures(stopId, now - 10 * 60_000)[0]!;

describe("TransitStore vehicle progress", () => {
  it("says a bus seen at the stop is at the stop", async () => {
    const store = await load();
    reportDwelling(store);
    store.setVehicleProgress(atStop("0:111", true), now);

    expect(first(store).status).toBe(StopTimeStatus.atStop);
  });

  it("says nothing about a call the bus has not reached", async () => {
    // Untouched, rather than SCHEDULED: a call nobody has said anything about
    // is sent without prediction fields at all.
    const store = await load();
    store.setVehicleProgress(atStop("0:111", true), now);

    const ahead = first(store, "0:101");
    expect(ahead.status).toBeUndefined();
    expect(ahead.reported).toBeUndefined();
  });

  it("says a bus has departed once it is past the call", async () => {
    const store = await load();
    reportDwelling(store);
    store.setVehicleProgress(atStop("0:101", false), now);

    expect(first(store).status).toBe(StopTimeStatus.departed);
  });

  it("leaves a call alone while no vehicle is reporting the trip", async () => {
    // The prediction is behind the clock, which is what a bus that has pulled
    // in early looks like. Without a vehicle to say so, nothing here calls it
    // departed — the renderer holds the row to its scheduled time instead.
    const store = await load();
    reportDwelling(store);

    const departure = first(store);
    expect(departure.status).toBe(StopTimeStatus.scheduled);
    expect(departure.reported).toBe(true);
    expect(departure.predictedTime).toBe(dwelling);
  });

  it("keeps a cancellation, whatever the bus in front of it is doing", async () => {
    const store = await load();
    store.setStopTimeUpdates(
      [
        {
          serviceDate: "20260817",
          tripId: "t1",
          stopId: "0:111",
          predictedTime: scheduled,
          status: StopTimeStatus.skipped,
        },
      ],
      new Date(now)
    );
    store.setVehicleProgress(atStop("0:111", true), now);

    expect(first(store).status).toBe(StopTimeStatus.skipped);
  });

  it("pins a vehicle to the running it is on, not tomorrow's", async () => {
    // The vehicle feed names a trip and not the day it started, and this trip
    // runs again tomorrow. A bus past the first stop today must not mark
    // tomorrow's first departure as one that has already gone.
    const store = await load();
    store.setVehicleProgress(atStop("0:101", false), now);

    const tomorrow = store
      .departures("0:111", now - 10 * 60_000)
      .find((departure) => departure.serviceDate === "20260818");

    expect(tomorrow).toBeDefined();
    expect(tomorrow!.status).toBeUndefined();
  });

  it("forgets a bus that has stopped reporting", async () => {
    const store = await load();
    store.setVehicleProgress(atStop("0:111", true), now);
    store.setVehicleProgress([], now);

    expect(first(store).status).toBeUndefined();
  });
});

/**
 * A stop's window is scheduled, and a late bus falls out of it while it is
 * still on its way — which is the moment a rider most wants the row. These say
 * when it is held past the window and when it is let go.
 */
describe("TransitStore.departures() and a late bus", () => {
  /** Half an hour after the 10:00 departure, well past the ten-minute window. */
  const late = new Date("2026-08-17T14:30:00Z").getTime();
  const window = 10 * 60_000;
  const listed = (store: TransitStore, at: number) =>
    store
      .departures("0:111", at - window, ARRIVALS_LIMIT, at)
      .filter((departure) => departure.scheduledTime === scheduled);

  it("keeps a bus the vehicle feed has not yet brought to the stop", async () => {
    const store = await load();
    // Tracked, and still short of 0:111 — so it has not gone, whatever the
    // timetable says about half an hour ago.
    store.setVehicleProgress(atStop("0:111", false), late);

    expect(listed(store, late)).toHaveLength(1);
  });

  it("keeps a bus standing at the stop", async () => {
    const store = await load();
    store.setVehicleProgress(atStop("0:111", true), late);

    expect(listed(store, late)[0]!.status).toBe(StopTimeStatus.atStop);
  });

  it("keeps a bus the agency still predicts is coming", async () => {
    // No vehicle, but a prediction naming a time that has not arrived yet.
    const store = await load();
    store.setStopTimeUpdates(
      [
        {
          serviceDate: "20260817",
          tripId: "t1",
          stopId: "0:111",
          predictedTime: late + 5 * 60_000,
          status: StopTimeStatus.scheduled,
        },
      ],
      new Date(late)
    );

    expect(listed(store, late)).toHaveLength(1);
  });

  it("lets an unreported departure slide off on schedule", async () => {
    // Silence is not evidence that a bus is late. Nothing has been said about
    // this one since the timetable was written, so it goes when its time does.
    const store = await load();

    expect(listed(store, late)).toHaveLength(0);
  });

  it("lets a departed bus go", async () => {
    const store = await load();
    store.setVehicleProgress(atStop("0:101", false), late);

    expect(listed(store, late)).toHaveLength(0);
  });

  it("does not hold a cancellation open", async () => {
    // Cancelled is not late: nothing is coming, so nothing is kept.
    const store = await load();
    store.setStopTimeUpdates(
      [
        {
          serviceDate: "20260817",
          tripId: "t1",
          stopId: "0:111",
          predictedTime: late + 5 * 60_000,
          status: StopTimeStatus.skipped,
        },
      ],
      new Date(late)
    );

    expect(listed(store, late)).toHaveLength(0);
  });

  it("still holds a bus an hour and a quarter late", async () => {
    const store = await load();
    const wayLate = scheduled + 75 * 60_000;
    store.setVehicleProgress(atStop("0:111", true), wayLate);

    expect(listed(store, wayLate)).toHaveLength(1);
  });

  it("gives up ninety minutes behind the timetable", async () => {
    // Past that, a bus that has never departed is likelier to be a vehicle the
    // agency lost track of than one still on its way.
    const store = await load();
    const muchLater = scheduled + 100 * 60_000;
    store.setVehicleProgress(atStop("0:111", true), muchLater);

    expect(listed(store, muchLater)).toHaveLength(0);
  });
});
