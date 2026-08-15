/**
 * @file The rider's saved and recently viewed stops.
 *
 * Kept in cookies, in the same two keys and the same JSON shape the React app
 * used, so anyone who has stops saved today still has them after the switch.
 * (Cookies rather than localStorage was originally so the server could render
 * them; nothing renders them on the server any more, but changing the storage
 * would silently drop everyone's stops, which is a far worse trade than a
 * slightly odd choice of store.)
 */

const SAVED_KEY = "savedStops";
const RECENT_KEY = "recentStops";
/** Saved and recent share this budget; saved stops get the room first. */
export const MAX_QUICK_STOPS = 10;

const ONE_YEAR = 365 * 24 * 60 * 60;

function read(key) {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${key}=`));
  if (!cookie) return [];

  try {
    const value = JSON.parse(decodeURIComponent(cookie.slice(key.length + 1)));
    return Array.isArray(value)
      ? value.filter((code) => typeof code === "string")
      : [];
  } catch {
    // A malformed cookie is not worth a broken page; treat it as empty and it
    // will be overwritten by the next save.
    return [];
  }
}

function write(key, codes) {
  document.cookie = `${key}=${JSON.stringify(codes)}; path=/; SameSite=Lax; max-age=${ONE_YEAR}`;
}

export function savedStops() {
  return read(SAVED_KEY);
}

export function recentStops() {
  return read(RECENT_KEY);
}

export function isSaved(stopCode) {
  return savedStops().includes(stopCode);
}

/** Returns the new saved state, so a caller can update its button. */
export function toggleSaved(stopCode) {
  const saved = savedStops();

  if (saved.includes(stopCode)) {
    write(
      SAVED_KEY,
      saved.filter((code) => code !== stopCode)
    );
    return false;
  }

  write(SAVED_KEY, [stopCode, ...saved.filter((code) => code !== stopCode)]);
  // A saved stop does not also need to be a recent one — that would spend the
  // quick stops budget twice on the same stop. Unsaving puts it back, at the
  // front, via addRecent on the next visit.
  write(
    RECENT_KEY,
    recentStops().filter((code) => code !== stopCode)
  );
  return true;
}

export function addRecent(stopCode) {
  const recent = recentStops();
  write(
    RECENT_KEY,
    [stopCode, ...recent.filter((code) => code !== stopCode)].slice(
      0,
      MAX_QUICK_STOPS
    )
  );
}
