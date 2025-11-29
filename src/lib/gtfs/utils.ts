import { addSeconds } from "date-fns";
import { toDate } from "date-fns-tz";

/**
 * Convert a GTFS time‑of‑day string (`HH:MM:SS`) to the number of
 * seconds after midnight. Because this represents a local time
 * in the time zone of the transit service it will always represent
 * seconds since midnight in the local time zone.
 *
 * GTFS allows “extended” hours (e.g. *25:10:00* for trips that finish
 * after midnight of the service date). Only minutes ∈ [0, 59] and
 * seconds ∈ [0, 59] are permitted.
 *
 * @param timeOfDay – A GTFS‑formatted local time, `HH:MM:SS`.
 *
 * @returns Seconds past midnight as an integer ≥ 0.
 *
 * @throws `Error` if the string is not `HH:MM:SS` or has invalid
 *         minute/second values.
 *
 * @example
 * getSecondsSinceMidnight("01:23:45");   // 5025
 * getSecondsSinceMidnight("25:00:00");   // 90000  (1 h after next midnight)
 */
function getSecondsSinceMidnight(timeOfDay: string): number {
  const gtfsTimeRegex = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;
  const match = timeOfDay.match(gtfsTimeRegex);

  if (!match) {
    throw new Error(`Invalid GTFS time format: ${timeOfDay}`);
  }

  // This assertion is OK because the regex guarantees numeric substrings
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);

  if (
    hours < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    throw new Error(`Invalid GTFS time format: ${timeOfDay}`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Convert a GTFS *service date* (`yyyyMMdd`) **plus** a GTFS local
 * time‑of‑day (`HH:MM:SS`) into an **absolute Unix epoch** (ms).
 *
 * The conversion is **independent of the server’s process timezone**.
 * ‑ `serviceDate` is parsed in the specified `timeZone`.
 * ‑ `timeOfDay` is added relative to local midnight, allowing hours > 24.
 *
 * @param serviceDate – Local service date in GTFS format `yyyyMMdd`.
 * @param timeOfDay – Local time-of-day `HH:MM:SS` (may exceed 24 h).
 * @param timeZone – IANA TZ name (e.g. *"America/New_York"*).
 *
 * @returns date object representing the GTFS time in UTC.
 *
 * @example
 * // Trip that departs at 01:15 the *next* calendar day:
 * gtfsTimestamp("20231001", "25:15:00", "America/New_York");
 * // →
 *
 * @see getSecondsSinceMidnight
 */
export function gtfsTimestamp(
  serviceDate: string,
  timeOfDay: string,
  timeZone: string
): Date {
  const secondsSinceMidnight = getSecondsSinceMidnight(timeOfDay);
  // `toDate` creates a Date at *local midnight* in the given TZ.
  const date = toDate(serviceDate, { timeZone });
  return addSeconds(date, secondsSinceMidnight);
}
