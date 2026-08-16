/**
 * @file Writing the site's live data to disk.
 *
 * This is what replaces the API. Instead of a server answering the same
 * question 650 different ways on demand, the worker — which already has every
 * answer in hand — writes them out as files, and nginx serves them. Nothing
 * runs at request time.
 *
 * Two things are written for every stop:
 *
 *   - `<data>/arrivals/<code>.json`, polled by the page as the times tick over;
 *   - `<site>/stops/<code>/index.html`, with the same arrivals already rendered
 *     into it, so a page arrives with real times rather than a skeleton and a
 *     fetch.
 *
 * Both come from the same renderer the browser uses, so the first paint and
 * the first refresh cannot disagree.
 */

import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { subMinutes } from "date-fns";

import { renderArrivals } from "../../public/js/render-arrivals.js";
import { Model } from "@/lib/model";

/** The comments site/stops.njk puts around the arrivals block. */
const ARRIVALS_START = "<!--arrivals:start-->";
const ARRIVALS_END = "<!--arrivals:end-->";

/** Matches what the old /api/arrivals route returned. */
const ARRIVAL_LIMIT = 20;
const ARRIVAL_WINDOW_MINUTES = 10;

/** Stops queried at once. Redis is fast; the point is to not open 650 at once. */
const BATCH = 32;

const MINUTE_MS = 60_000;

const run = promisify(execFile);

export class SnapshotWriter {
  private shells = new Map<
    string,
    { path: string; head: string; tail: string }
  >();
  /**
   * What was last written to each path, and the mtime it had afterwards.
   *
   * Skipping identical writes is not about disk — the data directory is a few
   * megabytes of tmpfs. It is about `Last-Modified`: nginx answers the page's
   * conditional requests from the file's mtime, so rewriting a file whose
   * contents did not change turns a 304 into a fresh 7 KB download, once a
   * second, on a phone. Most stops do change on any given refresh; the quiet
   * ones, and every stop overnight, are the ones this protects.
   *
   * The mtime is what makes the skip safe. A site build — `npm run site:watch`
   * during development, say — replaces these files underneath us with empty
   * shells, and a stop whose arrivals happen not to have changed since would
   * otherwise keep the placeholder until its next departure, which overnight
   * is hours. So the write is skipped only when the file on disk is still the
   * one we put there.
   */
  private written = new Map<string, { content: string; mtimeMs: number }>();

  private lastFeedUpdate = 0;
  private lastRenderedMinute = 0;
  /**
   * The mtime of a page only Eleventy writes, so a build anyone starts — `npm
   * run site:watch` during development — is noticed and adopted. Without this
   * the worker would keep splicing arrivals into the shells it read at
   * startup, quietly overwriting the rebuilt pages with the old templates.
   */
  private lastSiteBuild = 0;

  constructor(
    private model: Model,
    private dataDir: string,
    private siteDir: string
  ) {}

  /**
   * Reads each stop page once and remembers the parts around its arrivals
   * block, so writing a page later is two string joins rather than a read.
   * Called again after every site build, because the pages are new files then.
   */
  async loadShells(): Promise<void> {
    this.shells.clear();
    this.written.clear();

    const stopsDir = join(this.siteDir, "stops");
    let codes: string[];
    try {
      codes = await readdir(stopsDir);
    } catch {
      console.warn(
        `[snapshots] no stop pages at ${stopsDir} — build the site first`
      );
      return;
    }

    for (const code of codes) {
      const path = join(stopsDir, code, "index.html");
      let html: string;
      try {
        html = await readFile(path, "utf8");
      } catch {
        continue;
      }

      const start = html.indexOf(ARRIVALS_START);
      const end = html.indexOf(ARRIVALS_END);
      if (start === -1 || end === -1) {
        console.warn(`[snapshots] ${path} has no arrivals markers; skipping`);
        continue;
      }

      this.shells.set(code, {
        path,
        head: html.slice(0, start + ARRIVALS_START.length),
        tail: html.slice(end),
      });
    }
    console.log(`[snapshots] ${this.shells.size} stop pages ready to fill`);
  }

  /**
   * Rebuilds the site, then reloads the shells. Runs when the static GTFS feed
   * changes — stop names, codes and routes are baked into the HTML, so that is
   * the moment they are wrong until rebuilt.
   */
  async buildSite(): Promise<void> {
    console.log("[snapshots] rebuilding the site...");
    try {
      const { stdout } = await run("node_modules/.bin/eleventy", [], {
        cwd: process.cwd(),
      });
      console.log(stdout.trim().split("\n").at(-1));
      await this.loadShells();
    } catch (error) {
      // A failed build leaves the previous site in place, which is stale but
      // whole — far better than tearing down a working site over it.
      console.error("[snapshots] site build failed:", error);
    }
  }

  /** Reloads the shells when the site has been rebuilt by anything but us. */
  private async adoptRebuiltSite(): Promise<void> {
    let stamp: number;
    try {
      stamp = (await stat(join(this.siteDir, "index.html"))).mtimeMs;
    } catch {
      return;
    }
    if (stamp === this.lastSiteBuild) return;

    // Skips the reload the first time round: loadShells has just run.
    if (this.lastSiteBuild !== 0) await this.loadShells();
    this.lastSiteBuild = stamp;
  }

  private async writeIfChanged(path: string, content: string): Promise<void> {
    const previous = this.written.get(path);
    if (previous?.content === content) {
      try {
        if ((await stat(path)).mtimeMs === previous.mtimeMs) return;
      } catch {
        // Gone. Write it again.
      }
    }

    // Written and renamed rather than written in place: a poll landing
    // mid-write would otherwise read half a file.
    const temporary = `${path}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, path);
    this.written.set(path, { content, mtimeMs: (await stat(path)).mtimeMs });
  }

  async writeArrivals(now: number): Promise<void> {
    const stops = await this.model.getStops();
    const after = subMinutes(new Date(now), ARRIVAL_WINDOW_MINUTES);
    await mkdir(join(this.dataDir, "arrivals"), { recursive: true });

    for (let index = 0; index < stops.length; index += BATCH) {
      await Promise.all(
        stops.slice(index, index + BATCH).map(async (stop) => {
          if (!stop.stopCode) return;

          const arrivals = await this.model.getStopTimeInstances(
            stop.stopId,
            after,
            ARRIVAL_LIMIT
          );

          await this.writeIfChanged(
            join(this.dataDir, "arrivals", `${stop.stopCode}.json`),
            JSON.stringify(arrivals)
          );

          const shell = this.shells.get(stop.stopCode);
          if (!shell) return;
          await this.writeIfChanged(
            shell.path,
            shell.head + renderArrivals(arrivals, now) + shell.tail
          );
        })
      );
    }
    this.lastRenderedMinute = Math.floor(now / MINUTE_MS);
  }

  async writeVehiclePositions(): Promise<void> {
    const raw = await this.model.getVehiclePositionsRaw();
    await this.writeIfChanged(
      join(this.dataDir, "vehicle-positions.json"),
      raw ?? "[]"
    );
  }

  async writeAlerts(): Promise<void> {
    const alerts = await this.model.getAlerts();
    await this.writeIfChanged(
      join(this.dataDir, "alerts.json"),
      JSON.stringify(alerts)
    );
  }

  /**
   * One pass, once a second.
   *
   * Arrivals are rewritten when the feed moves — every five seconds, in this
   * agency's case — and once a minute regardless, because the countdowns in
   * the page HTML are relative to the time they were rendered and would
   * otherwise age. Unchanged files are not rewritten either way.
   */
  async tick(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.adoptRebuiltSite();

    const now = Date.now();
    const feedUpdate =
      (await this.model.getStopsLastUpdatedAt())?.getTime() ?? 0;
    const feedMoved = feedUpdate !== this.lastFeedUpdate;
    const minuteTurned =
      Math.floor(now / MINUTE_MS) !== this.lastRenderedMinute;

    if (feedMoved || minuteTurned) {
      this.lastFeedUpdate = feedUpdate;
      await this.writeArrivals(now);
    }

    await Promise.all([this.writeVehiclePositions(), this.writeAlerts()]);
  }
}
