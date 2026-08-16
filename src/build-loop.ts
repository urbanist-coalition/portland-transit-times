/**
 * @file Running the builder on a timer.
 *
 * The builder itself is a one-shot program — download, build, flip, exit —
 * because that is the honest shape of a build and it makes `npm run
 * build:release` something you can run by hand at any moment. This is the
 * container's job: run it every so often, never twice at once, and log what
 * happened.
 *
 * The interval is short because a build is cheap when nothing has changed: the
 * builder downloads 1.4 MB, hashes it, finds the current release already
 * matches, and stops. Only a new feed or a new commit costs anything, and only
 * a new feed costs the map.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CronJob } from "cron";

const run = promisify(execFile);

/**
 * Every ten minutes. A build that finds the same feed hash exits before doing
 * any work, so checking often is nearly free — and it is what decides how long
 * a schedule change sits unpublished.
 */
const SCHEDULE = process.env.BUILD_SCHEDULE ?? "0 */10 * * * *";

let building = false;

async function build() {
  if (building) {
    console.log("[loop] previous build still running");
    return;
  }
  building = true;
  try {
    const { stdout, stderr } = await run("npx", ["tsx", "src/builder.ts"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  } catch (error) {
    // The builder reports its own failures and publishes nothing, so the
    // previous release keeps serving. This only records that it happened.
    console.error("[loop] build failed:", (error as Error).message);
  } finally {
    building = false;
  }
}

CronJob.from({
  cronTime: SCHEDULE,
  onTick: build,
  start: true,
  // A container that has just started should not wait ten minutes to find out
  // there is no release yet.
  runOnInit: true,
  waitForCompletion: true,
});
