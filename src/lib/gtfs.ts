import { parse as csvParser } from "csv-parse";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import os from "node:os";
import unzipper from "unzipper";

import model from "@/lib/redis";

/**
 * Download the GTFS ZIP and extract it to a new temporary directory.
 * Returns the path to that temp directory.
 */
export async function downloadGTFS(): Promise<string> {
  // Create a unique temp directory (e.g., /tmp/gtfs-XXXXXX)
  const tmpDir = await mkdtemp(join(os.tmpdir(), "gtfs-"));

  // Use https.get + pipeline directly to stream download -> unzipper
  await new Promise<void>((resolve, reject) => {
    https
      .get("https://gtfs.gptd.cadavl.com/GPTD/GTFS/GTFS_GPTD.zip", (res) => {
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

// Example interface: adapt it to your actual CSV columns
interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign: string;
  direction_id: string;
  block_id: string;
  shape_id: string;
}

/**
 * Downloads the GTFS, extracts it into a temp directory, reads `trips.txt`,
 * saves data to Redis, and then cleans up the temp folder.
 */
export async function loadTripIdToRouteID() {
  console.log("Loading trip_id -> route_id mapping...");

  // Download & extract to a temp directory
  const tempDir = await downloadGTFS();

  try {
    // For example, parse "trips.txt" from the temp folder
    const tripsFile = join(tempDir, "trips.txt");
    const trips: Trip[] = await csvParse<Trip>(tripsFile);

    await model.setTripRouteID(
      trips.map(({ trip_id, route_id }) => [trip_id, route_id])
    );
  } finally {
    // Clean up: remove the entire temp folder
    await rm(tempDir, { recursive: true, force: true });
  }
}
