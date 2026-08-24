/**
 * @file Writing the live data of the current release.
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
 *
 * The trip pages are filled in the same way, from the other side: a page for a
 * bus that is out on the road now gets the predictions written into it, and
 * gets its timetable put back when that bus reaches the end of its run.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { subMinutes } from "date-fns";

import { renderArrivals } from "../../public/js/render-arrivals.js";
import { renderTripCalls } from "../../public/js/render-trip.js";
import { tripSlug } from "../../public/js/trips.js";
import { ARRIVALS_LIMIT } from "@/lib/feed/expand";
import { TransitStore } from "@/lib/feed/store";

/** The comments site/stops.njk puts around the arrivals block. */
const ARRIVALS_START = "<!--arrivals:start-->";
const ARRIVALS_END = "<!--arrivals:end-->";

/** The comments site/trip.njk puts around the list of calls. */
const CALLS_START = "<!--calls:start-->";
const CALLS_END = "<!--calls:end-->";

/**
 * How far back a departure stays on the page after it has gone — long enough
 * that someone who just missed one sees why.
 *
 * A bound on the *timetable*, not on the bus: one running late has not gone,
 * and TransitStore.departures keeps it past this until it does.
 */
const ARRIVAL_WINDOW_MINUTES = 10;

/** Stops written at once. The work is cheap; the point is to not open 650 files at once. */
const BATCH = 32;

const MINUTE_MS = 60_000;

/** A page with a hole in it: what comes before the block, and what comes after. */
interface Shell {
  path: string;
  head: string;
  tail: string;
}

/** A trip page, which also knows what it says when its bus is not running. */
interface TripShell extends Shell {
  /**
   * The timetable, rendered from the feed rather than read out of the file.
   *
   * The file is not a reliable source for this: a worker that stops while a bus
   * is running leaves that trip's page holding predictions, and reading them
   * back as "what this page says normally" would make them permanent.
   */
  schedule: string;
}

export class SnapshotWriter {
  private shells = new Map<string, Shell>();
  private tripShells = new Map<string, TripShell>();
  /**
   * Trip pages that are not showing their timetable, and need putting back.
   *
   * A stop always has a next departure, so its page is rewritten on every pass
   * and cannot go stale. A trip stops being live the moment its bus finishes,
   * and nothing would otherwise replace the predictions frozen in its page. So
   * they are tracked: what went live this pass, plus anything found out of date
   * at startup, which is how a page survives the worker being restarted while
   * its bus was out.
   */
  private liveTripPages = new Set<string>();
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

  constructor(
    private store: TransitStore,
    private dataDir: string,
    private siteDir: string
  ) {}

  /**
   * Points the writer at one release, by its own path.
   *
   * Deliberately not through the `current` symlink, which moves. A page shell
   * is read once and written back many times, so a write that began with one
   * release's HTML must not land in another release's directory because the
   * link changed in between — see the comment where the worker calls this.
   */
  retarget(dataDir: string, siteDir: string): void {
    this.dataDir = dataDir;
    this.siteDir = siteDir;
  }

  /**
   * Reads a directory of pages once and remembers the parts around the block
   * that gets rewritten, so writing one later is two string joins rather than
   * a read.
   */
  private async readShells(
    directory: string,
    startMarker: string,
    endMarker: string
  ): Promise<Map<string, Shell>> {
    const shells = new Map<string, Shell>();

    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      console.warn(
        `[snapshots] no pages at ${directory} — build the site first`
      );
      return shells;
    }

    for (const name of names) {
      const path = join(directory, name, "index.html");
      const shell = await this.readShell(path, startMarker, endMarker);
      if (shell) shells.set(name, shell);
    }
    return shells;
  }

  /** One page, split around its block. Null if it has not got one. */
  private async readShell(
    path: string,
    startMarker: string,
    endMarker: string
  ): Promise<(Shell & { body: string }) | null> {
    let html: string;
    try {
      html = await readFile(path, "utf8");
    } catch {
      return null;
    }

    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker);
    if (start === -1 || end === -1) {
      console.warn(`[snapshots] ${path} has no markers; skipping`);
      return null;
    }

    return {
      path,
      head: html.slice(0, start + startMarker.length),
      body: html.slice(start + startMarker.length, end),
      tail: html.slice(end),
    };
  }

  /**
   * Reads the trip pages, and notices any that a previous worker left holding
   * live times.
   *
   * Driven by the feed rather than by the directory, because the timetable each
   * page should be showing comes from the feed — and comparing the two is what
   * finds the pages that need putting back.
   */
  private async loadTripShells(): Promise<void> {
    this.tripShells.clear();
    const stale = new Set<string>();

    for (const trip of this.store.trips()) {
      const slug = tripSlug(trip.tripId);
      const path = join(this.siteDir, "trips", slug, "index.html");
      const shell = await this.readShell(path, CALLS_START, CALLS_END);
      if (!shell) continue;

      const schedule = renderTripCalls(this.store.tripSchedule(trip.tripId));
      this.tripShells.set(slug, {
        path: shell.path,
        head: shell.head,
        tail: shell.tail,
        schedule,
      });
      if (shell.body !== schedule) stale.add(slug);
    }

    // Restored on the first pass. A page whose bus is running again by then is
    // simply written live instead, which is the same answer.
    this.liveTripPages = stale;
    if (stale.size) {
      console.log(`[snapshots] ${stale.size} trip pages to put back`);
    }
  }

  /**
   * Reads every page that gets filled in. Called again after every site build,
   * because the pages are new files then.
   */
  async loadShells(): Promise<void> {
    this.written.clear();

    /*
     * Trip snapshots are written only while a bus is running and removed when
     * it finishes, so any left here belong to a worker that stopped mid-run.
     * A page polling one of those would be handed this morning's predictions
     * as though the bus were still out; there is no such thing as a snapshot
     * worth keeping across a restart, so none are kept.
     */
    await rm(join(this.dataDir, "trips"), { recursive: true, force: true });

    this.shells = await this.readShells(
      join(this.siteDir, "stops"),
      ARRIVALS_START,
      ARRIVALS_END
    );
    await this.loadTripShells();

    console.log(
      `[snapshots] ${this.shells.size} stop pages and ` +
        `${this.tripShells.size} trip pages ready to fill`
    );
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
    try {
      await writeFile(temporary, content);
      await rename(temporary, path);
      this.written.set(path, { content, mtimeMs: (await stat(path)).mtimeMs });
    } catch (error) {
      /*
       * The release these pages belong to has been pruned out from under us: a
       * build landed while this pass was still running, and the pass for the
       * new release is a second behind. There is nothing to write to and
       * nothing wrong — but it must not take the rest of the pass down with
       * it, or one stop's vanished directory would stop every other stop being
       * written for that tick.
       */
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async writeArrivals(now: number): Promise<void> {
    const stops = this.store.stops();
    const after = subMinutes(new Date(now), ARRIVAL_WINDOW_MINUTES).getTime();
    await mkdir(join(this.dataDir, "arrivals"), { recursive: true });

    for (let index = 0; index < stops.length; index += BATCH) {
      await Promise.all(
        stops.slice(index, index + BATCH).map(async (stop) => {
          if (!stop.stopCode) return;

          const arrivals = this.store.departures(
            stop.stopId,
            after,
            ARRIVALS_LIMIT,
            now
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

  /**
   * Writes live times into the pages of the buses that are out now, and puts
   * the timetable back into the pages of the ones that have finished.
   *
   * Only the running ones are touched. There are 1,345 trips and around 150 of
   * them are on the road at once, so rendering all of them every second would
   * be forty thousand rows a tick to change a few hundred — and every trip that
   * is not running has nothing to say beyond what the build already wrote.
   */
  async writeTrips(now: number): Promise<void> {
    const live = this.store.liveTrips(now);
    const written = new Set<string>();
    await mkdir(join(this.dataDir, "trips"), { recursive: true });

    /** The page body each trip should now have, live or back to its timetable. */
    const pages: [Shell, string][] = [];
    /** The snapshot each running trip's page polls, as it watches the bus. */
    const snapshots: [string, string][] = [];

    for (const [tripId, calls] of live) {
      const slug = tripSlug(tripId);
      const shell = this.tripShells.get(slug);
      if (!shell) continue;
      pages.push([shell, renderTripCalls(calls, now)]);
      snapshots.push([slug, JSON.stringify(calls)]);
      written.add(slug);
    }

    /*
     * A trip that has stopped running loses both halves at once: its page goes
     * back to the timetable, and the file its page was polling goes away. The
     * page then finds a 404 and keeps what it has, which is the timetable —
     * rather than a last set of predictions that would sit there all night.
     */
    const finished: string[] = [];
    for (const slug of this.liveTripPages) {
      if (written.has(slug)) continue;
      const shell = this.tripShells.get(slug);
      if (shell) pages.push([shell, shell.schedule]);
      finished.push(slug);
    }

    for (let index = 0; index < pages.length; index += BATCH) {
      await Promise.all(
        pages
          .slice(index, index + BATCH)
          .map(([shell, body]) =>
            this.writeIfChanged(shell.path, shell.head + body + shell.tail)
          )
      );
    }

    await Promise.all([
      ...snapshots.map(([slug, json]) =>
        this.writeIfChanged(join(this.dataDir, "trips", `${slug}.json`), json)
      ),
      ...finished.map((slug) => this.removeSnapshot(slug)),
    ]);

    this.liveTripPages = written;
  }

  /** Forgets a finished trip's snapshot, on disk and in the written map. */
  private async removeSnapshot(slug: string): Promise<void> {
    const path = join(this.dataDir, "trips", `${slug}.json`);
    this.written.delete(path);
    await rm(path, { force: true });
  }

  async writeVehiclePositions(): Promise<void> {
    const raw = this.store.getVehiclePositionsRaw();
    await this.writeIfChanged(
      join(this.dataDir, "vehicle-positions.json"),
      raw ?? "[]"
    );
  }

  async writeAlerts(): Promise<void> {
    const alerts = this.store.getAlerts();
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

    const now = Date.now();
    // Yesterday's expansion does not cover tomorrow.
    this.store.expandIfStale(now);
    const feedUpdate = this.store.getPredictionsUpdatedAt()?.getTime() ?? 0;
    const feedMoved = feedUpdate !== this.lastFeedUpdate;
    const minuteTurned =
      Math.floor(now / MINUTE_MS) !== this.lastRenderedMinute;

    if (feedMoved || minuteTurned) {
      this.lastFeedUpdate = feedUpdate;
      await this.writeArrivals(now);
      await this.writeTrips(now);
    }

    await Promise.all([this.writeVehiclePositions(), this.writeAlerts()]);
  }
}
