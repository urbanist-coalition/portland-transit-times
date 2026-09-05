/**
 * @file What the panel is willing to show, and what it must always be.
 *
 * A 1-bit frame diffs perfectly as text, so where a rendering is asserted here
 * it is asserted as characters: a layout regression shows up as the thing that
 * moved rather than as a changed hash.
 *
 * The rest is the contract the firmware is written against. The .bin describes
 * none of its own conventions — not its size, not which way up it is, not
 * whether a set bit is ink — so every one of them is pinned here instead.
 */

import { LiveStopTimeInstance, Route, StopTimeStatus, Trip } from "@/types";
import { Bitmap1 } from "./canvas";
import { toBin, toBmp } from "./encode";
import { frameKey, renderStopDisplay } from "./layout";
import { GDEM075T41WT } from "./profile";

const now = Date.UTC(2026, 8, 5, 16, 0);
const minutes = (count: number) => now + count * 60_000;

const route = (routeShortName: string): Route => ({
  routeId: routeShortName,
  routeShortName,
  routeColor: "#B23073",
  routeTextColor: "#FFFFFF",
});

const trip = (tripHeadsign: string): Trip => ({
  tripId: `t-${tripHeadsign}`,
  routeId: "1",
  serviceId: "School Day",
  shapeId: "s",
  tripHeadsign,
});

function arrival(
  at: number,
  headsign = "Maine Mall",
  extra: Partial<LiveStopTimeInstance> = {}
): LiveStopTimeInstance {
  return {
    serviceDate: "20260905",
    tripId: `t-${at}`,
    stopId: "0:1",
    scheduledTime: at,
    route: route("5"),
    trip: trip(headsign),
    ...extra,
  };
}

const stop = { stopCode: "1117", stopName: "Congress St + Center St" };

const render = (arrivals: LiveStopTimeInstance[], at = now) =>
  renderStopDisplay({ stop, arrivals, now: at, profile: GDEM075T41WT });

describe("the frame the panel is handed", () => {
  it("is always exactly one framebuffer, whatever is drawn on it", () => {
    const full = toBin(
      render([...Array(20)].map((_, i) => arrival(minutes(i))))
    );
    const empty = toBin(render([]));

    // 800 x 480 at one bit is 100 bytes a row. A packed buffer has no
    // compression, so a busy stop and a closed one are the same 48,000 bytes.
    expect(full.length).toBe(48_000);
    expect(empty.length).toBe(48_000);
  });

  it("says the same thing as the BMP beside it", () => {
    const frame = render([arrival(minutes(5))]);
    const bin = toBin(frame);
    const bmp = toBmp(frame);

    expect(bmp.length).toBe(bin.length + 62);
    expect(bmp.subarray(bmp.readUInt32LE(10))).toEqual(bin);
  });

  it("clears to the value the panel's own clear routine writes", () => {
    /*
     * The convention the whole raw-buffer argument rests on. The UC8179 family
     * fills with 0xFF to blank the screen, so a frame written that way round
     * can be streamed into panel SRAM untouched — and one written the other way
     * round makes the firmware invert 48,000 bytes before every draw.
     */
    const blank = new Bitmap1(64, 8);

    expect([...new Set(blank.data)]).toEqual([0xff]);
    expect(blank.get(0, 0)).toBe(false);

    blank.set(0, 0);
    expect(blank.get(0, 0)).toBe(true);
    expect(blank.data[0]).toBe(0x7f); // the top bit cleared, the rest paper
  });

  it("is top-down, one bit deep, with ink at palette index zero", () => {
    const bmp = toBmp(render([arrival(minutes(5))]));

    expect(bmp.toString("ascii", 0, 2)).toBe("BM");
    expect(bmp.readInt32LE(18)).toBe(800);
    // Negative height: rows run top-down, in the panel's own order rather than
    // BMP's usual bottom-up, so the preview cannot be upside down.
    expect(bmp.readInt32LE(22)).toBe(-480);
    expect(bmp.readUInt16LE(28)).toBe(1);
    expect(bmp.readUInt32LE(54) & 0xffffff).toBe(0x000000); // 0 is ink
    expect(bmp.readUInt32LE(58) & 0xffffff).toBe(0xffffff); // 1 is paper
  });
});

describe("which buses get a row", () => {
  it("gives a bus that has gone at most one of the six", () => {
    const arrivals = [
      arrival(minutes(-9), "Gone A"),
      arrival(minutes(-6), "Gone B"),
      arrival(minutes(-3), "Gone C"),
      arrival(minutes(4), "Coming"),
    ];

    /*
     * The website keeps ten minutes of departures so a rider who sees an empty
     * street knows they have just missed one. Six rows cannot afford three of
     * them, and the newest is the one that explains the empty street.
     */
    const ink = countRows(render(arrivals));
    expect(ink).toBe(2);
  });

  it("fills the panel with buses someone can still catch", () => {
    const arrivals = [...Array(12)].map((_, i) => arrival(minutes(i + 1)));
    expect(countRows(render(arrivals))).toBe(GDEM075T41WT.rows);
  });

  it("says so plainly when nothing is due", () => {
    // Overnight is a real state for this agency, and a blank rectangle reads as
    // a broken panel rather than as the last bus having gone. So: no rows, and
    // ink in the middle of the panel where nothing is otherwise ever drawn.
    const frame = render([]);

    expect(countRows(frame)).toBe(0);
    expect(inkIn(frame, 200, 220, 600, 260)).toBeGreaterThan(0);
  });
});

describe("when the panel is worth redrawing", () => {
  const arrivals = [arrival(minutes(6)), arrival(minutes(20), "Riverton")];
  const key = (at: number) =>
    frameKey({ stop, arrivals, now: at, profile: GDEM075T41WT });

  it("does not redraw because the clock moved", () => {
    /*
     * The whole point of keying on content. The frame prints its own age, so
     * its pixels differ every minute — comparing those would flash the panel
     * for four seconds, sixty times an hour, to move one line of small text.
     */
    expect(key(now)).toBe(key(now + 60_000));
    expect(key(now)).toBe(key(now + 4 * 60_000));
  });

  it("redraws when the agency says something new about a bus", () => {
    const late = [
      arrival(minutes(6), "Maine Mall", {
        predictedTime: minutes(10),
        status: StopTimeStatus.scheduled,
        reported: true,
      }),
      arrivals[1]!,
    ];

    expect(
      frameKey({ stop, arrivals: late, now, profile: GDEM075T41WT })
    ).not.toBe(key(now));
  });

  it("redraws when a bus goes", () => {
    // The row set itself changes: one bus moves into the departed slot, and
    // whatever was seventh becomes visible.
    expect(key(now)).not.toBe(key(minutes(8)));
  });
});

/**
 * Rows, counted by the badges rather than by the renderer's own bookkeeping —
 * a test that asked the layout how many rows it drew would pass even if it
 * drew none.
 */
function countRows(frame: Bitmap1): number {
  let rows = 0;
  for (let y = 78; y < 450; y += 62) {
    let ink = 0;
    for (let x = 16; x < 80; x++) if (frame.get(x, y + 29)) ink++;
    if (ink > 40) rows++;
  }
  return rows;
}

/** Ink in a region. What "something was drawn here" means on a 1-bit panel. */
function inkIn(
  frame: Bitmap1,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  let ink = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (frame.get(x, y)) ink++;
  }
  return ink;
}
