import { parse as csvParser } from "csv-parse";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import os from "node:os";
import unzipper from "unzipper";
import { GTFSSystem } from "./types";

/**
 * Download the GTFS ZIP and extract it to a new temporary directory.
 * Returns the path to that temp directory.
 */
export async function downloadGTFS(staticURL: string): Promise<string> {
  // Create a unique temp directory (e.g., /tmp/gtfs-XXXXXX)
  const tmpDir = await mkdtemp(join(os.tmpdir(), "gtfs-"));

  // Use https.get + pipeline directly to stream download -> unzipper
  await new Promise<void>((resolve, reject) => {
    https
      .get(staticURL, (res) => {
        pipeline(
          res,
          unzipper.Extract({ path: tmpDir }) // extract all files here
        )
          .then(() => resolve())
          .catch(reject);
      })
      .on("error", reject);
  });

  return tmpDir;
}

/**
 * Load a CSV file from disk into an array of objects.
 */
export async function csvParse<T>(filePath: string): Promise<T[]> {
  const readStream = createReadStream(filePath);
  const parser = csvParser({
    columns: true, // treat first row as headers
    skip_empty_lines: true,
  });

  readStream.pipe(parser);

  return new Promise<T[]>((resolve, reject) => {
    const records: T[] = [];

    parser.on("data", (record) => {
      records.push(record as T);
    });

    parser.on("error", (error) => {
      reject(error);
    });

    parser.on("end", () => {
      resolve(records);
    });

    // Handle potential errors from the read stream itself
    readStream.on("error", (error) => {
      reject(error);
    });
  });
}

export interface Route {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  route_type: string;
  route_color: string;
  route_text_color: string;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign: string;
  direction_id: string;
  block_id: string;
  shape_id: string;
}

export interface Shape {
  shape_id: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
  shape_pt_sequence: string;
  shape_dist_traveled: string;
}

export interface Stop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_desc: string;
  stop_lat: string;
  stop_lon: string;
  zone_id: string;
  location_type: string;
  parent_station: string;
  vehicle_type: string;
}

export interface StopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: string;
  stop_headsign: string;
  shape_dist_traveled: string;
  timepoint: string;
}

export interface CalendarDate {
  service_id: string;
  date: string;
  exception_type: string;
}

export class GTFSStatic {
  staticURL: string;
  tempDir: string | undefined;

  static async create(system: GTFSSystem) {
    const gtfsStatic = new GTFSStatic(system);
    await gtfsStatic.load();
    console.log("GTFS static data loaded");
    return gtfsStatic;
  }

  constructor({ staticURL }: GTFSSystem) {
    this.staticURL = staticURL;
  }

  async load() {
    this.tempDir = await downloadGTFS(this.staticURL);
  }

  async cleanup() {
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = undefined;
      console.log("GTFS static data cleaned up");
    }
  }

  [Symbol.asyncDispose]() {
    return this.cleanup();
  }

  async getRoutes(): Promise<Route[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const routesFile = join(this.tempDir, "routes.txt");
    return await csvParse<Route>(routesFile);
  }

  async getTrips(): Promise<Trip[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const tripsFile = join(this.tempDir, "trips.txt");
    return await csvParse<Trip>(tripsFile);
  }

  async getShapes(): Promise<Shape[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const shapesFile = join(this.tempDir, "shapes.txt");
    return await csvParse<Shape>(shapesFile);
  }

  async getStops(): Promise<Stop[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const stopsFile = join(this.tempDir, "stops.txt");
    return await csvParse<Stop>(stopsFile);
  }

  async getStopTimes(): Promise<StopTime[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const stopTimesFile = join(this.tempDir, "stop_times.txt");
    return await csvParse<StopTime>(stopTimesFile);
  }

  async getCalendarDates(): Promise<CalendarDate[]> {
    if (!this.tempDir) {
      throw new Error("GTFS data not loaded");
    }
    const calendarDatesFile = join(this.tempDir, "calendar_dates.txt");
    return await csvParse<CalendarDate>(calendarDatesFile);
  }
}
