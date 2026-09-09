/**
 * @file When a screen may reload itself.
 *
 * The board is the one page on this site that cannot fix itself by being
 * navigated to, so it watches the release it is being served from. Both halves
 * of that are ways to get a television on a wall into a state nobody is
 * standing next to: reloading for something that did not change, and reloading
 * over and over for something that did.
 */

import { releaseId, shouldAdopt } from "../../public/js/release.js";

const manifest = {
  feedHash: "44adb0e7",
  appVersion: "sha-09f6aab",
  builtAt: "2026-09-09T14:45:48.763Z",
};

describe("releaseId()", () => {
  it("changes when the code does", () => {
    expect(releaseId(manifest)).not.toBe(
      releaseId({ ...manifest, appVersion: "sha-1b0223c" })
    );
  });

  it("changes when the timetable does", () => {
    // The stop's name and its route pills are built into the board's markup
    // rather than polled, so a renamed stop needs the page loaded again.
    expect(releaseId(manifest)).not.toBe(
      releaseId({ ...manifest, feedHash: "b29b6019" })
    );
  });

  it("ignores when it was built", () => {
    // The builder runs every ten minutes. If this counted, a screen would
    // reload itself all day for nothing.
    expect(
      releaseId({ ...manifest, builtAt: "2027-01-01T00:00:00.000Z" })
    ).toBe(releaseId(manifest));
  });

  it("refuses anything that is not a manifest", () => {
    // A proxy error page, a half-written file, a 404 body. None of these are a
    // new release, and treating them as one reloads the fleet.
    expect(releaseId(null)).toBeNull();
    expect(releaseId(undefined)).toBeNull();
    expect(releaseId("nope")).toBeNull();
    expect(releaseId({})).toBeNull();
    expect(releaseId({ feedHash: "abc" })).toBeNull();
    expect(releaseId({ feedHash: 1, appVersion: 2 })).toBeNull();
  });
});

describe("shouldAdopt()", () => {
  const booted = "44adb0e7:sha-09f6aab";
  const next = "44adb0e7:sha-1b0223c";

  it("reloads for a release it has not seen", () => {
    expect(shouldAdopt(booted, next, null)).toBe(true);
  });

  it("stays put when nothing has changed", () => {
    expect(shouldAdopt(booted, booted, null)).toBe(false);
  });

  it("tries a given release exactly once", () => {
    // The property that keeps a television off a reload loop. If the reload
    // did not take, the screen keeps running what it has until the next
    // release — old code still shows the times, a loop shows nothing.
    expect(shouldAdopt(booted, next, next)).toBe(false);
  });

  it("still reloads for the release after a failed one", () => {
    // One bad attempt must not wedge the screen forever.
    expect(shouldAdopt(booted, "44adb0e7:sha-75a7cb6", next)).toBe(true);
  });

  it("does nothing until it knows what it booted with", () => {
    expect(shouldAdopt(null, next, null)).toBe(false);
    expect(shouldAdopt(booted, null, null)).toBe(false);
  });
});
