/**
 * @file What the site is willing to claim about a bus.
 *
 * A status badge is a claim about a vehicle, so it takes the agency having
 * said something about that exact call. The site used to fill an unreported
 * departure in with its scheduled time and label the result "On Time", which
 * on a weekday afternoon was 92.5% of every row on every stop page, and
 * overnight was all of them.
 */

import { predictionStatus } from "../../public/js/render-arrivals.js";

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
