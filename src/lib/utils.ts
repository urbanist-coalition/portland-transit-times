import { Location } from "@/types";

/**
 * Determines if a hex color is too light, useful for determining text color and adding
 * borders when dealing with dynamic colors provided by the transit service.
 * @param hexColor - A string representing a hex color (e.g., "#FFFFFF" or "#FFF").
 * @param threshold - Optional threshold for deciding lightness (default is 0.8).
 * @returns True if the color is too light for white text, otherwise false.
 */
export function isTooLight(hexColor: string, threshold: number = 0.8): boolean {
  // Ensure the hex color is valid
  const hex = hexColor.replace("#", "");
  if (!/^([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
    throw new Error("Invalid hex color");
  }

  // Expand shorthand hex to full format if needed
  const fullHex =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

  // Convert hex to RGB values
  const r = parseInt(fullHex.substring(0, 2), 16) / 255;
  const g = parseInt(fullHex.substring(2, 4), 16) / 255;
  const b = parseInt(fullHex.substring(4, 6), 16) / 255;

  // Calculate relative luminance
  const luminance = (channel: number) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);

  const relativeLuminance =
    0.2126 * luminance(r) + 0.7152 * luminance(g) + 0.0722 * luminance(b);

  // Determine if the color is too light
  return relativeLuminance > threshold;
}

const R = 6371000; // Earth radius in meters
const toRadians = (deg: number) => deg * (Math.PI / 180);

export function distance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in meters
}

export function locationEquals(a: Location | undefined, b: Location): boolean {
  if (!a) return false;
  return a.lat === b.lat && a.lng === b.lng;
}

export function filterMap<T, R>(
  arr: T[],
  f: (t: T) => R | undefined | null
): R[] {
  return arr.map(f).filter((r): r is R => r !== undefined && r !== null);
}

export async function concurrentWindow<T, R>(
  arr: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  while (results.length < arr.length) {
    const promises = arr
      .slice(results.length, results.length + limit)
      .map((item) => fn(item));
    results.push(...(await Promise.all(promises)));
  }
  return results;
}
