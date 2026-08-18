/**
 * @file Reading and writing the release's static feed.
 *
 * One file, written whole and renamed into place, because the worker and the
 * site build both read it and neither should ever see half of one.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { StaticFeed } from "./types";

export async function writeStaticFeed(
  path: string,
  feed: StaticFeed
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(feed));
  await rename(temporary, path);

  const calls = feed.calls.length.toLocaleString();
  const handoffs = feed.calls.filter((call) => call.continues).length;
  console.log(
    `[feed] ${feed.stops.length} stops, ${feed.trips.length} trips, ` +
      `${calls} scheduled calls (${handoffs} of them block handoffs, which no ` +
      `stop offers) -> ${path}`
  );
}
