/**
 * @file Light/dark mode.
 *
 * The resolved mode lives in exactly one place — the `data-theme` attribute on
 * <html> — and CSS reads it directly, so the palette swaps with no JavaScript
 * on the render path. The inline script in the page <head> applies the stored
 * preference before first paint; this module is only for changing it and for
 * telling a page (the map) when it changed.
 */

const STORAGE_KEY = "color-mode";

function darkMediaQuery() {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function storedMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private browsing modes can throw on localStorage access
  }
  return "system";
}

/** "light" or "dark" — never "system", which is a preference, not an outcome. */
export function resolvedMode() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  const stored = storedMode();
  if (stored !== "system") return stored;
  return darkMediaQuery().matches ? "dark" : "light";
}

export function setColorMode(mode) {
  try {
    if (mode === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Preference won't persist, but the current page still switches
  }

  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;

  for (const listener of listeners) listener(resolvedMode());
}

/**
 * Flips to the opposite appearance, preferring "system" whenever that already
 * produces the appearance the user asked for. A user whose OS is dark and who
 * toggles light-then-dark ends up following their OS again rather than pinned
 * to an explicit choice.
 */
export function toggleColorMode() {
  const systemIsDark = darkMediaQuery().matches;

  if (resolvedMode() === "light") {
    setColorMode(systemIsDark ? "system" : "dark");
  } else {
    setColorMode(systemIsDark ? "light" : "system");
  }
}

const listeners = new Set();

/**
 * For the one page that cannot express its theme in CSS: the map, whose
 * basemap is a different style document per appearance. Fires on our own
 * toggle, on the OS preference changing, and on another tab changing it.
 */
export function onModeChange(listener) {
  if (listeners.size === 0) {
    darkMediaQuery().addEventListener("change", () => {
      for (const l of listeners) l(resolvedMode());
    });
    window.addEventListener("storage", () => {
      for (const l of listeners) l(resolvedMode());
    });
  }
  listeners.add(listener);
}
