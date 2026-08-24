/**
 * @file What the site is willing to claim about a bus.
 *
 * A status badge is a claim about a vehicle, so it takes the agency having
 * said something about that exact call. The site used to fill an unreported
 * departure in with its scheduled time and label the result "On Time", which
 * on a weekday afternoon was 92.5% of every row on every stop page, and
 * overnight was all of them.
 */

import {
  predictionStatus,
  renderArrivals,
} from "../../public/js/render-arrivals.js";

const now = Date.UTC(2026, 7, 17, 16, 0);
const minutes = (count: number) => now + count * 60_000;

describe("predictionStatus()", () => {
  it("says nothing about a departure nobody has reported", () => {
    const status = predictionStatus({ scheduledTime: minutes(10) }, now);

    expect(status.message).toBeNull();
    expect(status.tone).toBeNull();
  });

  it("calls a reported departure on time when it is", () => {
    const status = predictionStatus(
      {
        scheduledTime: minutes(10),
        predictedTime: minutes(10),
        status: "SCHEDULED",
        reported: true,
      },
      now
    );

    expect(status.message).toBe("On Time");
    expect(status.tone).toBe("ok");
  });

  it.each([
    [3, "3 min late", "late"],
    [-2, "2 min early", "early"],
  ])("reads a %s minute difference as %s", (delta, message, tone) => {
    const status = predictionStatus(
      {
        scheduledTime: minutes(10),
        predictedTime: minutes(10 + delta),
        status: "SCHEDULED",
        reported: true,
      },
      now
    );

    expect(status.message).toBe(message);
    expect(status.tone).toBe(tone);
  });

  it("still says a departure has gone, reported or not", () => {
    // Not a claim about the vehicle — the time has been and gone. Without it a
    // row that is over sits at the top of the list looking catchable.
    const status = predictionStatus({ scheduledTime: minutes(-5) }, now);

    expect(status.message).toBe("Departed");
    expect(status.departed).toBe(true);
  });

  it("moves an inferred time without vouching for it", () => {
    // A trip page carries the delay from the stops on either side across the
    // ones the agency skipped, so the column of times cannot run backwards.
    // The time moves; the badge does not appear.
    const status = predictionStatus(
      { scheduledTime: minutes(10), predictedTime: minutes(25) },
      now
    );

    expect(status.predicted).toBe(minutes(25));
    expect(status.delta).toBe(15);
    expect(status.message).toBeNull();
  });

  it("does not call a bus standing at the stop departed", () => {
    // Hancock St + Thames St, 4:48. The bus pulls in at 4:43 and the agency
    // reports the arrival it has made and a departure of "now" for the whole
    // layover, so both times are behind the clock while it sits there with its
    // doors open. What settles it is the vehicle, seen at the stop.
    const status = predictionStatus(
      {
        scheduledTime: minutes(5),
        predictedTime: minutes(-2),
        status: "AT_STOP",
        reported: true,
      },
      now
    );

    expect(status.departed).toBe(false);
    expect(status.message).toBe("At the stop");
    expect(status.tone).toBe("ok");
  });

  it("does not call a waiting bus early", () => {
    // The departure time of a bus that is standing at the stop is only the
    // moment the feed was built, so it says nothing about the timetable.
    const status = predictionStatus(
      {
        scheduledTime: minutes(5),
        predictedTime: minutes(-2),
        status: "AT_STOP",
        reported: true,
      },
      now
    );

    expect(status.predicted).toBe(minutes(5));
    expect(status.delta).toBe(0);
  });

  it("still counts a bus at the stop as late once its time has gone", () => {
    const status = predictionStatus(
      {
        scheduledTime: minutes(-6),
        predictedTime: minutes(-1),
        status: "AT_STOP",
        reported: true,
      },
      now
    );

    expect(status.predicted).toBe(minutes(-1));
    expect(status.delta).toBe(5);
    expect(status.departed).toBe(false);
  });

  it("keeps a departure whose scheduled time is still ahead of it", () => {
    // Nobody has reported the vehicle, and the prediction is behind the clock —
    // which at a first call means the bus arrived early, not that it left. The
    // timetable is what the rider walking to the stop is going by.
    const status = predictionStatus(
      {
        scheduledTime: minutes(4),
        predictedTime: minutes(-5),
        status: "SCHEDULED",
        reported: true,
      },
      now
    );

    expect(status.departed).toBe(false);
  });

  it("lets a departure go once both times are behind the clock", () => {
    const status = predictionStatus(
      {
        scheduledTime: minutes(-4),
        predictedTime: minutes(-5),
        status: "SCHEDULED",
        reported: true,
      },
      now
    );

    expect(status.departed).toBe(true);
    expect(status.message).toBe("Departed");
  });

  it("takes the agency's word for it when a vehicle has gone", () => {
    // Before its scheduled time, which is what an early departure is.
    const status = predictionStatus(
      {
        scheduledTime: minutes(6),
        predictedTime: minutes(-1),
        status: "DEPARTED",
        reported: true,
      },
      now
    );

    expect(status.departed).toBe(true);
  });

  it("reports a cancellation whatever else is true of it", () => {
    const status = predictionStatus(
      {
        scheduledTime: minutes(10),
        predictedTime: minutes(10),
        status: "SKIPPED",
        reported: true,
      },
      now
    );

    expect(status.message).toBe("Canceled");
    expect(status.tone).toBe("warn");
  });
});

describe("renderArrivals()", () => {
  const route = {
    routeId: "r1",
    routeShortName: "5",
    routeColor: "#00B050",
    routeTextColor: "#FFFFFF",
  };
  const trip = {
    tripId: "t1",
    routeId: "r1",
    serviceId: "weekday",
    shapeId: "s1",
    tripHeadsign: "City Hall",
  };
  const arrival = (overrides = {}) => ({
    serviceDate: "20260817",
    tripId: "t1",
    stopId: "0:1",
    scheduledTime: minutes(4),
    route,
    trip,
    ...overrides,
  });

  it("counts down to a timepoint as a departure", () => {
    // The bus is held to a timepoint rather than passing through it, so it is
    // standing there waiting for the time — which is what a rider three minutes
    // down the street is deciding on.
    const html = renderArrivals([arrival({ timepoint: true })], now);

    expect(html).toContain("Departs in 4 min");
  });

  it("counts down to every other call as an arrival", () => {
    const html = renderArrivals([arrival()], now);

    expect(html).toContain("Arriving in 4 min");
  });

  it("counts down to an ending as an arrival, timepoint or not", () => {
    // Nobody boards a bus going to the garage.
    const html = renderArrivals(
      [arrival({ timepoint: true, terminates: true })],
      now
    );

    expect(html).toContain("Arriving in 4 min");
  });

  it("counts down to nothing for a bus that is not coming", () => {
    const html = renderArrivals(
      [
        arrival({
          predictedTime: minutes(4),
          status: "SKIPPED",
          reported: true,
        }),
      ],
      now
    );

    expect(html).toContain("Canceled");
    expect(html).not.toContain("arrival-countdown");
  });

  it("says where the bus is when it is standing at the stop", () => {
    const html = renderArrivals(
      [
        arrival({
          predictedTime: minutes(-2),
          status: "AT_STOP",
          reported: true,
          timepoint: true,
        }),
      ],
      now
    );

    expect(html).toContain("At the stop now");
    expect(html).not.toContain("Departed");
  });
});
