/**
 * @file What the TV board leaves out.
 *
 * The board shares every judgement about a bus with the stop page — that is
 * what importing predictionStatus buys, and render-arrivals.test.ts is where
 * those judgements are pinned down. What is worth testing here is only where
 * the board deliberately disagrees with the page about *presentation*, because
 * each of those is a decision someone could undo by accident:
 *
 *   - a departed bus is dropped rather than kept for ten minutes;
 *   - the list stops at three, however many buses are due;
 *   - the headline slot holds a count, a word or a clock time, and the small
 *     print under it stops repeating whichever one it is.
 */

import { renderTvBoard } from "../../public/js/render-tv.js";

const now = Date.UTC(2026, 7, 17, 16, 0);
const minutes = (count: number) => now + count * 60_000;

const route = {
  routeId: "5",
  routeShortName: "5",
  routeColor: "#1a4d25",
  routeTextColor: "#ffffff",
};

interface ArrivalOverrides {
  minutesAway?: number;
  tripId?: string;
  [key: string]: unknown;
}

function arrival({
  minutesAway = 10,
  tripId = "trip",
  ...rest
}: ArrivalOverrides = {}) {
  return {
    serviceDate: "20260817",
    tripId,
    stopId: "0:1117",
    scheduledTime: minutes(minutesAway),
    route,
    trip: { tripId, tripHeadsign: "Maine Mall" },
    ...rest,
  };
}

describe("renderTvBoard()", () => {
  it("counts the next bus down in minutes", () => {
    const html = renderTvBoard([arrival({ minutesAway: 8 })], now);

    expect(html).toContain(">8</span>");
    expect(html).toContain("mins</span>");
    expect(html).toContain("to Maine Mall");
  });

  it("drops a bus that has gone", () => {
    // The stop page keeps one for ten minutes, so a rider looking at an empty
    // street learns they have just missed it. Nobody is standing at a board on
    // a wall, so a departure that is over is only taking the next bus's space.
    const html = renderTvBoard(
      [
        arrival({ minutesAway: -4, tripId: "gone" }),
        arrival({ minutesAway: 9 }),
      ],
      now
    );

    expect(html).not.toContain("Departed");
    expect(html).toContain(">9</span>");
  });

  it("gives the hero to the soonest bus, not the earliest scheduled", () => {
    // The snapshot arrives in scheduled order, so a bus running twelve minutes
    // late still sorts ahead of an on-time one leaving five minutes after it.
    // On the page that is survivable; here it would put the wrong number in
    // letters a foot high.
    const html = renderTvBoard(
      [
        arrival({
          minutesAway: 0,
          predictedTime: minutes(12),
          reported: true,
          tripId: "late",
        }),
        arrival({ minutesAway: 5, tripId: "on-time" }),
      ],
      now
    );

    // Matched on the countdown span specifically: the route is called "5" too.
    const [hero, rows] = html.split('<div class="tv-next">');
    expect(hero).toMatch(/class="tv-count"[^>]*>5<\/span>/);
    expect(rows).toContain(">12 <small>mins</small>");
  });

  it("stops showing a bus nobody has moved in ninety minutes", () => {
    // A bus standing at the stop is never "departed", so without the same
    // ninety-minute bound the page applies, a board left running against a
    // worker that stopped writing announces "Now" for the rest of the evening.
    const stuck = arrival({
      minutesAway: -95,
      predictedTime: minutes(-95),
      status: "AT_STOP",
      reported: true,
    });

    expect(renderTvBoard([stuck], now)).toContain("No buses due");
    expect(
      renderTvBoard([{ ...stuck, scheduledTime: minutes(-80) }], now)
    ).toContain(">Now</span>");
  });

  it("says so when there is nothing left to show", () => {
    expect(renderTvBoard([arrival({ minutesAway: -30 })], now)).toContain(
      "No buses due"
    );
    expect(renderTvBoard([], now)).toContain("No buses due");
  });

  it("shows the next bus and no more than two behind it", () => {
    const html = renderTvBoard(
      [5, 10, 15, 20, 25].map((m) =>
        arrival({ minutesAway: m, tripId: `trip-${m}` })
      ),
      now
    );

    expect(html.match(/class="tv-row"/g)).toHaveLength(2);
    expect(html).not.toContain(">25</span>");
  });

  it("names the clock time when the minutes stop meaning anything", () => {
    const html = renderTvBoard([arrival({ minutesAway: 75 })], now);

    expect(html).toContain("1:15 pm");
    // Once, as the headline — not again underneath it as the scheduled time.
    expect(html.match(/1:15 pm/g)).toHaveLength(1);
  });

  it("keeps the scheduled time when something has superseded it", () => {
    // The headline is the prediction; the struck-through original is the only
    // thing that explains why the bus is not coming when the timetable says.
    const html = renderTvBoard(
      [
        arrival({
          minutesAway: 70,
          predictedTime: minutes(75),
          reported: true,
        }),
      ],
      now
    );

    expect(html).toContain("tv-time-superseded");
    expect(html).toContain("1:10 pm");
    expect(html).toContain("1:15 pm");
  });

  it("does not print a word twice, once big and once as a badge", () => {
    const html = renderTvBoard(
      [arrival({ minutesAway: 6, status: "SKIPPED", reported: true })],
      now
    );

    expect(html.match(/Canceled/g)).toHaveLength(1);
    expect(html).not.toContain("tv-status");
  });

  it("colours the headline only where it is a word", () => {
    // A count of minutes in the late colour reads as an alarm about a bus that
    // is perfectly catchable; the badge carries lateness instead.
    const late = renderTvBoard(
      [arrival({ minutesAway: 6, predictedTime: minutes(9), reported: true })],
      now
    );
    expect(late).not.toContain("data-tone");
    expect(late).toContain('data-status="late"');

    const atStop = renderTvBoard(
      [
        arrival({
          minutesAway: 0,
          predictedTime: minutes(0),
          status: "AT_STOP",
          reported: true,
        }),
      ],
      now
    );
    expect(atStop).toContain('data-tone="ok"');
    expect(atStop).toContain(">Now</span>");
  });

  it("tells the stylesheet how much it has to fit", () => {
    // "8" and "Canceled" share one slot and cannot share one size.
    expect(renderTvBoard([arrival({ minutesAway: 8 })], now)).toContain(
      "--tv-count-len:1"
    );
    expect(
      renderTvBoard(
        [arrival({ minutesAway: 6, status: "SKIPPED", reported: true })],
        now
      )
    ).toContain("--tv-count-len:8");
  });

  it("does not offer a headsign for a bus that ends here", () => {
    const html = renderTvBoard(
      [arrival({ minutesAway: 7, terminates: true })],
      now
    );

    expect(html).toContain("ends here");
    expect(html).not.toContain("Maine Mall");
  });
});
