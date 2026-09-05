/**
 * Renders stop panels and writes them where a release would carry them.
 *
 *   npm run render:display              every installation in displays.json
 *   npm run render:display -- 1117      one stop, whether or not it has hardware
 *   npm run render:display -- 1117 /tmp/preview
 *
 * Output mirrors the release layout — <out>/stops/<code>/display/<device>/ —
 * so what this writes and what nginx serves are the same paths.
 *
 * The worker does this on a schedule for the stops that have panels. This is
 * the same call by hand: for a stop that does not yet have one, and for seeing
 * a layout change without waiting for a release.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GPMETRO } from "@/lib/constants";
import { ARRIVALS_LIMIT } from "@/lib/feed/expand";
import { TransitStore } from "@/lib/feed/store";
import { Releases } from "@/lib/release";
import { toBin, toBmp } from "@/lib/display/encode";
import { installations } from "@/lib/display/installations";
import { renderStopDisplay } from "@/lib/display/layout";
import { GDEM075T41WT } from "@/lib/display/profile";

const ARRIVAL_WINDOW_MS = 10 * 60 * 1000;

async function main() {
  const [code, outArg] = process.argv.slice(2);
  const out = outArg ?? "_displays";

  const releases = new Releases(
    process.env.RELEASES_DIR ?? "releases",
    process.env.DATA_DIR ?? "_data"
  );
  const current = await releases.current();
  if (!current) throw new Error("no current release — build one first");

  const store = new TransitStore(GPMETRO.timeZone);
  await store.loadStatic(join(releases.path(current), "static.json"));

  const targets = code
    ? [{ stopCode: code, profile: GDEM075T41WT }]
    : installations();
  if (!targets.length) {
    console.log("[display] no installations configured");
    return;
  }

  const now = Date.now();
  for (const { stopCode, profile } of targets) {
    const stop = store.stops().find((s) => s.stopCode === stopCode);
    if (!stop) {
      console.warn(`[display] no stop with code ${stopCode}`);
      continue;
    }

    const arrivals = store.departures(
      stop.stopId,
      now - ARRIVAL_WINDOW_MS,
      ARRIVALS_LIMIT,
      now
    );
    const frame = renderStopDisplay({ stop, arrivals, now, profile });

    const dir = join(out, "stops", stopCode, "display", profile.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "display.bin"), toBin(frame));
    await writeFile(join(dir, "display.bmp"), toBmp(frame));

    console.log(
      `[display] ${stopCode.padEnd(5)} ${profile.id}  ` +
        `${String(arrivals.length).padStart(2)} arrivals  ${stop.stopName}`
    );
  }
}

main();
