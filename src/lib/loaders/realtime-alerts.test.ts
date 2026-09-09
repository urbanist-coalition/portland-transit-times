/**
 * @file What survives decoding a service alert.
 *
 * This exists because of one property of protobufjs: decoding fills every
 * unset scalar in with its type's default, so a selector that named nothing
 * but a stop comes back also claiming `routeType: 0` and `directionId: 0`, and
 * a window with no end comes back with `end: 0`. Both are values a reader will
 * believe — 0 is a tram, 0 is a direction, and 0 is 1970 — so an alert with no
 * end date reads as long expired and one aimed at a stop reads as aimed at
 * trams. GTFS-RT is proto2 and keeps presence; the loader tests for it.
 *
 * The live feed carries no alerts most weeks, which is exactly why this is
 * synthetic: there is nothing to look at when it matters, and the code path
 * only runs on the day something has gone wrong on the network.
 */

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

import { GPMETRO } from "@/lib/constants";
import { GTFSRealtimeLoader } from "@/lib/loaders/realtime";
import { TransitStore } from "@/lib/feed/store";
import { Alert } from "@/types";

const { FeedMessage, Alert: RtAlert } = GtfsRealtimeBindings.transit_realtime;

type AlertPayload = Parameters<typeof RtAlert.encode>[0];

const text = (value: string) => ({
  translation: [{ language: "en", text: value }],
});

/** Runs one synthetic alert through the real loader and returns what it stored. */
async function load(alert: AlertPayload): Promise<Alert[]> {
  const payload = FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [{ id: "alert-1", alert }],
  }).finish();

  let stored: Alert[] = [];
  const store = {
    setAlerts: (alerts: Alert[]) => {
      stored = alerts;
    },
  } as unknown as TransitStore;

  const fetchMock = jest
    .fn()
    .mockResolvedValue(new Response(payload as unknown as BodyInit));
  const original = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  try {
    await new GTFSRealtimeLoader(GPMETRO, store).loadServiceAlerts();
  } finally {
    globalThis.fetch = original;
  }
  return stored;
}

/** The same, for the cases that expect exactly one alert back. */
async function loadOne(alert: AlertPayload): Promise<Alert> {
  const alerts = await load(alert);
  if (alerts.length !== 1) {
    throw new Error(`expected one alert, got ${alerts.length}`);
  }
  return alerts[0]!;
}

const minimal = {
  headerText: text("Stop closed"),
  descriptionText: text("Use Congress St + High St"),
};

describe("loadServiceAlerts()", () => {
  it("keeps the header and description it always kept", async () => {
    const alert = await loadOne(minimal);

    expect(alert.id).toBe("alert-1");
    expect(alert.headerText).toBe("Stop closed");
    expect(alert.descriptionText).toBe("Use Congress St + High St");
  });

  it("keeps only the selector fields the feed actually set", async () => {
    const alert = await loadOne({
      ...minimal,
      informedEntity: [
        { stopId: "0:1117" },
        { routeId: "5", stopId: "0:1131" },
        { agencyId: "GPTD" },
        { trip: { tripId: "Saturday915070" } },
      ],
    });

    // No routeType or directionId anywhere: nothing set them.
    expect(alert.informedEntity).toEqual([
      { stopId: "0:1117" },
      { routeId: "5", stopId: "0:1131" },
      { agencyId: "GPTD" },
      { tripId: "Saturday915070" },
    ]);
  });

  it("keeps a zero that the feed meant", async () => {
    // The other half of the same rule: 0 is a tram and 0 is a direction, so a
    // selector that says so must survive, and must not be mistaken for unset.
    const alert = await loadOne({
      ...minimal,
      informedEntity: [{ routeType: 0, directionId: 0 }],
    });

    expect(alert.informedEntity).toEqual([{ routeType: 0, directionId: 0 }]);
  });

  it("does not invent an end for an open-ended window", async () => {
    const start = Math.floor(Date.UTC(2026, 8, 9, 6, 0) / 1000);
    const alert = await loadOne({ ...minimal, activePeriod: [{ start }] });

    expect(alert.activePeriod).toEqual([{ start: start * 1000 }]);
    expect(alert.activePeriod[0]).not.toHaveProperty("end");
  });

  it("states the window in milliseconds, like every other time", async () => {
    const start = Math.floor(Date.UTC(2026, 8, 9, 6, 0) / 1000);
    const end = Math.floor(Date.UTC(2026, 8, 9, 18, 0) / 1000);
    const alert = await loadOne({ ...minimal, activePeriod: [{ start, end }] });

    expect(alert.activePeriod).toEqual([
      { start: start * 1000, end: end * 1000 },
    ]);
  });

  it("names the severity and effect rather than numbering them", async () => {
    const alert = await loadOne({
      ...minimal,
      severityLevel: RtAlert.SeverityLevel.WARNING,
      effect: RtAlert.Effect.DETOUR,
    });

    expect(alert.severity).toBe("warning");
    expect(alert.effect).toBe("DETOUR");
  });

  it("says null where the feed said nothing", async () => {
    // Distinct from UNKNOWN_SEVERITY, which is the producer telling us it does
    // not know — this is the producer not telling us anything.
    const alert = await loadOne(minimal);

    expect(alert.severity).toBeNull();
    expect(alert.effect).toBeNull();
    expect(alert.informedEntity).toEqual([]);
    expect(alert.activePeriod).toEqual([]);
  });

  it("drops an alert with no English text, as it always did", async () => {
    expect(await load({ headerText: text("Stop closed") })).toEqual([]);
  });
});
