/**
 * @file A screen's configuration, which is entirely its address.
 *
 * Two directions to get wrong. Reading: anyone can type anything into an
 * address bar, and a board that believes it ends up wrong on a wall with
 * nobody next to it. Writing: the link is the only artefact there is, so if it
 * does not say exactly what somebody chose, nothing else records what they
 * meant.
 */

import {
  MESSAGE_MAX,
  ROWS_DEFAULT,
  SEVERITIES,
  SEVERITY_DEFAULT,
  buildBoardUrl,
  fromLocalInputValue,
  parseRows,
  readSettings,
  toLocalInputValue,
  toUrlInstant,
} from "../../public/js/tv-settings.js";

const now = Date.UTC(2026, 8, 9, 12, 0);
const hours = (n: number) => now + n * 3_600_000;
const ORIGIN = "https://transit.ucop.me";

describe("parseRows()", () => {
  it("accepts every count the board can lay out", () => {
    for (const n of [0, 1, 2, 3, 4]) expect(parseRows(String(n))).toBe(n);
  });

  it("refuses what it cannot lay out", () => {
    for (const bad of ["5", "-1", "2.5", "lots", "", null, undefined]) {
      expect(parseRows(bad)).toBeNull();
    }
  });
});

describe("readSettings()", () => {
  it("falls back to the default when the address says nothing", () => {
    const { rows, message } = readSettings("", now);
    expect(rows).toBe(ROWS_DEFAULT);
    expect(message).toBeNull();
  });

  it("takes the row count from the address", () => {
    expect(readSettings("?rows=4", now).rows).toBe(4);
    expect(readSettings("?rows=0", now).rows).toBe(0);
  });

  it("ignores a row count it cannot lay out", () => {
    // Anyone can edit an address bar, and a board that believed this would be
    // wrong on a wall with nobody standing next to it.
    expect(readSettings("?rows=99", now).rows).toBe(ROWS_DEFAULT);
    expect(readSettings("?rows=nope", now).rows).toBe(ROWS_DEFAULT);
  });

  it("returns the message shaped as an alert", () => {
    // Shaped, so the ticker never learns that one of them was typed by a
    // person: it already knows how to run several and order them.
    const { message } = readSettings("?msg=Lift+out&sev=severe", now);

    expect(message?.headerText).toBe("Lift out");
    expect(message?.severity).toBe("severe");
    expect(message?.informedEntity).toEqual([]);
    expect(message?.activePeriod).toEqual([]);
  });

  it("defaults the severity, and refuses one it does not know", () => {
    expect(readSettings("?msg=Lift+out", now).message?.severity).toBe(
      SEVERITY_DEFAULT
    );
    expect(
      readSettings("?msg=Lift+out&sev=URGENT", now).message?.severity
    ).toBe(SEVERITY_DEFAULT);
  });

  it("drops the message once its time is up", () => {
    // Why an expiry in a URL still works: the address does not expire, but the
    // board checks what it carries against the clock, so a screen rebooted a
    // week later reads the same link and shows nothing.
    const search = `?msg=Lift+out&until=${encodeURIComponent(
      new Date(hours(4)).toISOString()
    )}`;

    expect(readSettings(search, now).message).not.toBeNull();
    expect(readSettings(search, hours(5)).message).toBeNull();
  });

  it("runs indefinitely when the address names no end", () => {
    expect(readSettings("?msg=Lift+out", hours(10_000)).message).not.toBeNull();
  });

  it("keeps the rows even when the message has lapsed", () => {
    const { rows, message } = readSettings(
      "?rows=4&msg=Lift+out&until=2020-01-01T00:00:00Z",
      now
    );

    expect(rows).toBe(4);
    expect(message).toBeNull();
  });

  it("ignores a blank message and an unreadable expiry", () => {
    expect(readSettings("?msg=+++", now).message).toBeNull();
    // An expiry nobody can parse is treated as no expiry rather than as
    // expired: the message was meant to be seen, and dropping it silently is
    // the worse of the two misses.
    expect(
      readSettings("?msg=Lift+out&until=soon", now).message
    ).not.toBeNull();
  });

  it("will not let an address put a paragraph on the board", () => {
    const long = "x".repeat(MESSAGE_MAX + 50);
    expect(readSettings(`?msg=${long}`, now).message?.headerText).toHaveLength(
      MESSAGE_MAX
    );
  });
});

describe("buildBoardUrl()", () => {
  it("needs a stop and nothing else", () => {
    expect(buildBoardUrl(ORIGIN, { stopCode: "1117" })).toBe(
      "https://transit.ucop.me/stops/1117/tv/"
    );
    expect(buildBoardUrl(ORIGIN, { stopCode: "" })).toBe("");
    expect(buildBoardUrl(ORIGIN, {})).toBe("");
  });

  it("leaves out what is already the default", () => {
    // A link should say what somebody chose rather than restate the defaults
    // back at them — a board with nothing special about it gets a plain
    // address somebody can retype from memory.
    const url = buildBoardUrl(ORIGIN, {
      stopCode: "1117",
      rows: ROWS_DEFAULT,
      message: "Lift out",
      severity: SEVERITY_DEFAULT,
    });

    expect(url).not.toContain("rows=");
    expect(url).not.toContain("sev=");
    expect(url).toContain("msg=Lift+out");
  });

  it("carries everything that was chosen", () => {
    const url = buildBoardUrl(ORIGIN, {
      stopCode: "1117",
      rows: 4,
      message: "Lift out",
      severity: "severe",
      until: hours(4),
    });

    const { rows, message } = readSettings(new URL(url).search, now);
    expect(rows).toBe(4);
    expect(message?.headerText).toBe("Lift out");
    expect(message?.severity).toBe("severe");
    // To the minute: the address carries seconds, not milliseconds.
    expect(message?.until).toBe(Math.floor(hours(4) / 60_000) * 60_000);
  });

  it("drops the expiry and severity when there is no message to hang them on", () => {
    const url = buildBoardUrl(ORIGIN, {
      stopCode: "1117",
      message: "   ",
      severity: "severe",
      until: hours(4),
    });

    expect(url).toBe("https://transit.ucop.me/stops/1117/tv/");
  });

  it("refuses to let a stop code become part of the path", () => {
    // It is interpolated into the path rather than escaped into a parameter,
    // so anything that is not a stop code is stripped out.
    expect(buildBoardUrl(ORIGIN, { stopCode: "../../etc" })).toBe(
      "https://transit.ucop.me/stops/etc/tv/"
    );
    expect(buildBoardUrl(ORIGIN, { stopCode: "1117?x=1" })).toBe(
      "https://transit.ucop.me/stops/1117x1/tv/"
    );
  });

  it("survives a message full of things that mean something in a URL", () => {
    const message = "Detour via High St & Elm St — 50% longer #sorry";
    const url = buildBoardUrl(ORIGIN, { stopCode: "1117", message });

    expect(readSettings(new URL(url).search, now).message?.headerText).toBe(
      message
    );
  });
});

describe("the datetime field and the address", () => {
  it("round-trips an instant through the field and back", () => {
    // A round trip rather than a literal, so this says the same thing in every
    // timezone a machine might be set to.
    const at = new Date(2026, 8, 9, 14, 30).getTime();
    expect(fromLocalInputValue(toLocalInputValue(at))).toBe(at);
  });

  it("writes local time into the field, not UTC", () => {
    // The classic bug: toISOString() is Greenwich, and in Portland that
    // silently moves what somebody typed by four hours.
    const at = new Date(2026, 8, 9, 14, 30);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(toLocalInputValue(at.getTime())).toBe(
      `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(
        at.getHours()
      )}:${pad(at.getMinutes())}`
    );
  });

  it("writes the address instant with its offset, and reads it back", () => {
    // With the offset so the link can be read: "18:00-04:00" is six in the
    // evening to anyone who looks, where a bare epoch has to be worked out.
    const at =
      Math.floor(new Date(2026, 8, 9, 18, 0).getTime() / 60_000) * 60_000;
    const written = toUrlInstant(at);

    expect(written).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/
    );
    expect(new Date(written).getTime()).toBe(at);
  });

  it("reads an empty or unusable value as no expiry", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue(null)).toBeNull();
    expect(fromLocalInputValue("whenever")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
    expect(toUrlInstant(null)).toBe("");
  });
});

describe("severities", () => {
  it("offers exactly what the rail can colour", () => {
    // The stylesheet has a rule per value; one more here would reach it, match
    // nothing, and leave the rail quieter than whoever chose it intended.
    expect(SEVERITIES).toEqual(["info", "warning", "severe"]);
    expect(SEVERITIES).toContain(SEVERITY_DEFAULT);
  });
});
