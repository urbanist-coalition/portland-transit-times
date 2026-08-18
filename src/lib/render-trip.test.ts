/**
 * @file That a trip page's two kinds of row agree about the clock.
 *
 * A trip page is built with times of day taken straight from the timetable, and
 * the worker later rewrites the same rows from instants once the bus is
 * running. The two go through different formatters — string arithmetic on
 * "HH:MM:SS" for the first, Intl on an epoch for the second — and they sit in
 * one list, so a disagreement between them would show as a bus that changes its
 * arrival time by twelve hours the moment it sets off.
 */

import { formatClock } from "../../public/js/render-trip.js";
import { formatTime } from "../../public/js/render-arrivals.js";

/** The instant a Portland time of day falls at on a plain summer Monday. */
const on = (hours: number, minutes: number) =>
  Date.UTC(2026, 7, 17, hours + 4, minutes);

describe("formatClock()", () => {
  it.each([
    ["00:00:00", 0, 0],
    ["00:05:00", 0, 5],
    ["09:07:00", 9, 7],
    ["11:59:00", 11, 59],
    ["12:00:00", 12, 0],
    ["12:30:00", 12, 30],
    ["13:05:00", 13, 5],
    ["23:59:00", 23, 59],
  ])("reads %s the way the live rows do", (time, hours, minutes) => {
    expect(formatClock(time)).toBe(formatTime(on(hours, minutes)));
  });

  it("reads a trip that runs past midnight as the next morning", () => {
    // GTFS keeps counting: 25:10 is the service day before, ten past one.
    expect(formatClock("24:30:00")).toBe("12:30 am");
    expect(formatClock("25:10:00")).toBe("1:10 am");
  });
});
