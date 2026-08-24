/**
 * @file What normalising a feed has to get right.
 *
 * These are the cases that were wrong in production, written as fixtures so
 * they cannot come back once scripts/compare-loaders.ts and the loader it
 * compares against are deleted.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GTFSStatic } from "@/lib/gtfs/static";
import { normalizeFeed } from "./normalize";
import { StaticFeed } from "./types";

interface FeedFiles {
  stops: string[][];
  routes: string[][];
  trips: string[][];
  stopTimes: string[][];
  calendarDates: string[][];
}

const csv = (header: string, rows: string[][]) =>
  [header, ...rows.map((row) => row.join(","))].join("\n") + "\n";

/** Writes a minimal GTFS feed to disk and normalises it. */
async function normalize(files: Partial<FeedFiles> = {}): Promise<StaticFeed> {
  const directory = await mkdtemp(join(tmpdir(), "feed-test-"));
  const write = (name: string, contents: string) =>
    writeFile(join(directory, name), contents);

  await Promise.all([
    write(
      "stops.txt",
      csv(
        "stop_id,stop_code,stop_name,stop_lat,stop_lon",
        files.stops ?? [
          ["0:1", "1", "MAIN ST + FIRST ST", "43.65", "-70.25"],
          ["0:2", "2", "CITY HALL", "43.66", "-70.26"],
        ]
      )
    ),
    write(
      "routes.txt",
      csv(
        "route_id,route_short_name,route_color,route_text_color",
        files.routes ?? [["r1", "5", "00B050", "FFFFFF"]]
      )
    ),
    write(
      "trips.txt",
      csv(
        "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id",
        files.trips ?? [["r1", "weekday", "t1", "CITY HALL", "0", "b1", "s1"]]
      )
    ),
    write(
      "stop_times.txt",
      csv(
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,shape_dist_traveled,timepoint",
        files.stopTimes ?? [
          ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", "1"],
          ["t1", "10:10:00", "10:10:00", "0:2", "2", "", "", "1"],
        ]
      )
    ),
    write(
      "calendar_dates.txt",
      csv(
        "service_id,date,exception_type",
        files.calendarDates ?? [["weekday", "20260817", "1"]]
      )
    ),
  ]);

  return normalizeFeed(GTFSStatic.fromDirectory(directory, "test"));
}

const callAt = (feed: StaticFeed, tripId: string, stopId: string) =>
  feed.calls.find((call) => call.tripId === tripId && call.stopId === stopId);

describe("normalizeFeed()", () => {
  it("keeps a call where the bus waits, at its departure time", async () => {
    // The Pulse: arrive 10:00, sit for five minutes, leave at 10:05. The old
    // loader dropped the row outright because the two times differed, which
    // hid a third of the departures from the busiest stop in the system.
    const feed = await normalize({
      stopTimes: [
        ["t1", "10:00:00", "10:05:00", "0:1", "1", "", "", "1"],
        ["t1", "10:30:00", "10:30:00", "0:2", "2", "", "", "1"],
      ],
    });

    const call = callAt(feed, "t1", "0:1");
    expect(call).toBeDefined();
    expect(call!.time).toBe("10:05:00");
  });

  it("marks the calls the timetable holds the bus to", async () => {
    // A timepoint is a time the bus departs *at* — it waits if it is early —
    // and the rest are times it passes. That is the difference between telling
    // a rider the bus departs in four minutes and telling them it turns up in
    // four minutes, and it is all the app has to go on when no vehicle is
    // reporting.
    const feed = await normalize({
      stopTimes: [
        ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", "1"],
        ["t1", "10:04:12", "10:04:12", "0:2", "2", "", "", "0"],
      ],
    });

    expect(callAt(feed, "t1", "0:1")?.timepoint).toBe(true);
    expect(callAt(feed, "t1", "0:2")?.timepoint).toBeUndefined();
  });

  it("does not read a blank timepoint as a promise", async () => {
    // GTFS reads a blank as an exact time, but a blank is not the agency
    // saying anything, and this flag exists to say something stronger than the
    // schedule on its own supports.
    const feed = await normalize({
      stopTimes: [
        ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", ""],
        ["t1", "10:10:00", "10:10:00", "0:2", "2", "", "", ""],
      ],
    });

    expect(callAt(feed, "t1", "0:1")?.timepoint).toBeUndefined();
  });

  it("marks a trip's last call when its block carries on from that stop", async () => {
    // A bus reaches City Hall, waits, and leaves as the next trip. Offering the
    // arrival as well as the departure shows a rider two buses where there is
    // one, and the first turns into "Departed" in front of them — so the stop
    // does not offer it. The call is still where t1 ends, so it is still here.
    const feed = await normalize({
      trips: [
        ["r1", "weekday", "t1", "CITY HALL", "0", "b1", "s1"],
        ["r1", "weekday", "t2", "MAIN ST", "1", "b1", "s2"],
      ],
      stopTimes: [
        ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", "1"],
        ["t1", "10:10:00", "10:10:00", "0:2", "2", "", "", "1"],
        ["t2", "10:10:00", "10:10:00", "0:2", "1", "", "", "1"],
        ["t2", "10:20:00", "10:20:00", "0:1", "2", "", "", "1"],
      ],
    });

    expect(callAt(feed, "t1", "0:2")?.continues).toBe(true);
    expect(callAt(feed, "t2", "0:2")?.continues).toBeUndefined();
  });

  it("keeps a trip's last call, marked, when the bus finishes there", async () => {
    const feed = await normalize();

    const ending = callAt(feed, "t1", "0:2");
    expect(ending?.terminates).toBe(true);
    expect(ending?.continues).toBeUndefined();
  });

  it("times a trip's ending by when the bus gets there", async () => {
    // Nobody boards an ending, so the departure time — here the moment the bus
    // pulls out again, five minutes into its layover — is not what a rider
    // waiting at City Hall is watching for.
    const feed = await normalize({
      stopTimes: [
        ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", "1"],
        ["t1", "10:10:00", "10:15:00", "0:2", "2", "", "", "1"],
      ],
    });

    expect(callAt(feed, "t1", "0:2")?.time).toBe("10:10:00");
  });

  it("does not treat another service day's duty as the same bus", async () => {
    // block_id recurs across services: the same vehicle assignment on Sunday
    // and on a weekday. Ordering a block across both makes the next trip land
    // on the wrong day, and the layover goes unrecognised.
    const feed = await normalize({
      trips: [
        ["r1", "weekday", "t1", "CITY HALL", "0", "b1", "s1"],
        ["r1", "sunday", "t2", "MAIN ST", "1", "b1", "s2"],
      ],
      stopTimes: [
        ["t1", "10:00:00", "10:00:00", "0:1", "1", "", "", "1"],
        ["t1", "10:10:00", "10:10:00", "0:2", "2", "", "", "1"],
        ["t2", "10:10:00", "10:10:00", "0:2", "1", "", "", "1"],
        ["t2", "10:20:00", "10:20:00", "0:1", "2", "", "", "1"],
      ],
      calendarDates: [
        ["weekday", "20260817", "1"],
        ["sunday", "20260816", "1"],
      ],
    });

    // Different days, so neither trip continues the other: both endings stand.
    expect(callAt(feed, "t1", "0:2")?.terminates).toBe(true);
    expect(callAt(feed, "t2", "0:1")?.terminates).toBe(true);
  });

  it("cleans stop names without touching what the feed means", async () => {
    const feed = await normalize({
      stops: [
        ["0:1", "1", "FOREST AVE + USM Inbound", "43.65", "-70.25"],
        ["0:2", "2", "CITY HALL", "43.66", "-70.26"],
      ],
    });

    const stop = feed.stops.find((s) => s.stopId === "0:1");
    // Capitalised, the acronym kept, and the direction turned into a suffix.
    expect(stop?.stopName).toBe("Forest Ave + USM (Inbound)");
  });

  it("carries a trip's headsign, falling back to where it ends up", async () => {
    const feed = await normalize({
      trips: [["r1", "weekday", "t1", "", "0", "b1", "s1"]],
    });

    expect(feed.trips[0]!.tripHeadsign).toBe("City Hall");
  });

  it("only counts service a calendar date adds", async () => {
    const feed = await normalize({
      calendarDates: [
        ["weekday", "20260817", "1"],
        ["weekday", "20260818", "2"], // removed, e.g. a holiday
      ],
    });

    expect(feed.serviceDates["weekday"]).toEqual(["20260817"]);
  });
});
