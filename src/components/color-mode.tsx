"use client";

/**
 * @file Light/dark mode without a UI framework.
 *
 * The resolved mode lives in exactly one place — the `data-theme` attribute on
 *   <html> — and everything reads from there:
 *
 *   - CSS reads it directly (see globals.css), so the entire palette swaps with
 *     no JavaScript involved on the render path.
 *   - `useColorMode()` mirrors it into React for the few places that genuinely
 *     need the value in JS (the Leaflet basemap and route styling).
 *
 * `ColorModeScript` applies the stored preference before first paint so there
 *   is no flash of the wrong theme. When no preference is stored the attribute
 *   is absent and the OS preference wins via `prefers-color-scheme`.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "color-mode";

export type ColorMode = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

/**
 * Runs before hydration. Kept deliberately terse — it is inlined into the HTML
 *   of every page and blocks the first paint.
 */
const INIT_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(m==="light"||m==="dark")document.documentElement.dataset.theme=m}catch(e){}`;

export function ColorModeScript() {
  return <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />;
}

const listeners = new Set<() => void>();

// Cached so `getSnapshot` can return a referentially stable value; it is only
//   replaced when one of the two fields actually changes.
let snapshot: { mode: ColorMode; resolved: ResolvedColorMode } = {
  mode: "system",
  resolved: "light",
};

// The server has no way to know the user's preference. React swaps to the
//   client snapshot right after hydration, so this never causes a mismatch.
const SERVER_SNAPSHOT: { mode: ColorMode; resolved: ResolvedColorMode } = {
  mode: "system",
  resolved: "light",
};

function darkMediaQuery() {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function storedMode(): ColorMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private browsing modes can throw on localStorage access
  }
  return "system";
}

function getSnapshot() {
  const mode = storedMode();
  const resolved =
    mode === "system" ? (darkMediaQuery().matches ? "dark" : "light") : mode;

  if (snapshot.mode !== mode || snapshot.resolved !== resolved) {
    snapshot = { mode, resolved };
  }
  return snapshot;
}

function subscribe(onChange: () => void) {
  if (listeners.size === 0) {
    darkMediaQuery().addEventListener("change", notify);
    // Keep other tabs in sync
    window.addEventListener("storage", notify);
  }
  listeners.add(onChange);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      darkMediaQuery().removeEventListener("change", notify);
      window.removeEventListener("storage", notify);
    }
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function setColorMode(mode: ColorMode) {
  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // Preference won't persist, but the current page still switches
  }

  if (mode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  notify();
}

/**
 * Flips to the opposite appearance, preferring "system" whenever that already
 * produces the appearance the user asked for. This way a user whose OS is set
 * to dark and who toggles light-then-dark ends up following their OS again
 * rather than being pinned to an explicit choice.
 */
export function toggleColorMode() {
  const { resolved } = getSnapshot();
  const systemIsDark = darkMediaQuery().matches;

  if (resolved === "light") {
    setColorMode(systemIsDark ? "system" : "dark");
  } else {
    setColorMode(systemIsDark ? "light" : "system");
  }
}

/**
 * Reactive access to the current mode. Prefer plain CSS where possible — this
 * is for values that must be read in JavaScript, like the Leaflet tile URL.
 */
export function useColorMode() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
