import { gtfsTimestamp } from "./utils";

const DATE = "20231001"; // 1 Oct 2023

describe("gtfsTimestamp()", () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    // always restore the host TZ so tests stay isolated
    process.env.TZ = originalTZ;
    jest.resetModules(); // flush cached Date object behavior
  });

  it("converts a local GTFS time to the correct Unix epoch (America/New_York)", () => {
    const ts = gtfsTimestamp(DATE, "12:34:56", "America/New_York");
    // 2023‑10‑01 12:34:56 in New York == 2023‑10‑01 16:34:56 Z
    expect(ts).toBe(new Date("2023-10-01T16:34:56.000Z").getTime());
  });

  it("handles times beyond 24:00 by rolling into the next service day", () => {
    // 25:15:00 => 01:15 next calendar day
    const ts = gtfsTimestamp(DATE, "25:15:00", "America/New_York");
    expect(ts).toBe(new Date("2023-10-02T05:15:00.000Z").getTime());
  });

  it("produces the SAME result regardless of the server’s TZ", () => {
    process.env.TZ = "America/Los_Angeles";
    const west = gtfsTimestamp(DATE, "00:00:00", "America/New_York");

    process.env.TZ = "Europe/Paris";
    jest.resetModules(); // make Node pick up the new TZ
    const eu = gtfsTimestamp(DATE, "00:00:00", "America/New_York");

    expect(west).toBe(eu);
  });

  it("throws on malformed GTFS time strings", () => {
    expect(() => gtfsTimestamp(DATE, "24:00", "America/New_York")).toThrow(
      /Invalid GTFS time format/i
    );
  });
});
