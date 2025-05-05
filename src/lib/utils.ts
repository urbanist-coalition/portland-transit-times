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

export function filterMap<T, R>(
  arr: T[],
  f: (t: T) => R | undefined | null
): R[] {
  return arr.map(f).filter((r): r is R => r !== undefined && r !== null);
}

export function stopCodeToStopId(stopCode: string): string {
  return `0:${stopCode}`;
}

export function groupBy<T, K extends keyof T>(
  array: T[],
  key: K
): Map<T[K], T[]> {
  const index = new Map<T[K], T[]>();
  for (const item of array) {
    const current = index.get(item[key]) || [];
    index.set(item[key], [...current, item]);
  }
  return index;
}

export function indexBy<T, K extends keyof T>(
  array: T[],
  key: K
): Map<T[K], T> {
  const index = new Map<T[K], T>();
  for (const item of array) {
    index.set(item[key], item);
  }
  return index;
}

const dumbFetchMap = new Map<string, string>();

/**
 * dumbFetch puts the "if-modified-since" header into a custom header
 * because DigitalOcean's App Platform's Cloudflare Configuration strips
 * the "if-modified-since" header which is dumb.
 */
export async function dumbFetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);

  const prevLastModified = dumbFetchMap.get(input.toString());
  if (prevLastModified) {
    headers.append("x-if-modified-since", prevLastModified);
  }

  const resp = await fetch(input, { ...init, headers });
  const lastModified = resp.headers.get("last-modified");
  if (lastModified) {
    dumbFetchMap.set(input.toString(), lastModified);
  }
  return resp;
}

/**
 * dumbIfModifiedSince gets the "if-modified-since" header from the request
 * and returns it. It also checks for the custom "x-if-modified-since" header
 * because DigitalOcean's App Platform's Cloudflare Configuration strips
 * the "if-modified-since" header which is dumb.
 */

export function dumbIfModifiedSince(req: Request): string | null {
  return (
    req.headers.get("if-modified-since") ||
    req.headers.get("x-if-modified-since")
  );
}
