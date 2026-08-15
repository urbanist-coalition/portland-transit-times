/**
 * WCAG relative luminance of a hex color, from 0 (black) to 1 (white).
 * @param hexColor - A string representing a hex color (e.g., "#FFFFFF" or "#FFF").
 */
export function relativeLuminance(hexColor: string): number {
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

  const channelLuminance = (channel: number) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);

  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/**
 * Determines if a hex color is too light, useful for determining text color and adding
 * borders when dealing with dynamic colors provided by the transit service.
 * @param hexColor - A string representing a hex color (e.g., "#FFFFFF" or "#FFF").
 * @param threshold - Optional threshold for deciding lightness (default is 0.8).
 * @returns True if the color is too light for white text, otherwise false.
 */
export function isTooLight(hexColor: string, threshold: number = 0.8): boolean {
  return relativeLuminance(hexColor) > threshold;
}

/**
 * Picks black or white text for an arbitrary background, whichever has the
 * better contrast ratio. Replaces MUI's `theme.palette.getContrastText`, which
 * used the same 3:1-against-white rule.
 */
export function contrastText(hexColor: string): string {
  // A background lighter than this has a contrast ratio below 3:1 with white
  return relativeLuminance(hexColor) > 0.179 ? "#1a1a1a" : "#ffffff";
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
