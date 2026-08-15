"use client";

/**
 * @file Light/dark mode without a UI framework.
 *
 * The resolved mode lives in exactly one place — the `data-theme` attribute on
 *   <html> — and CSS reads it directly (see public/app.css), so the entire
 *   palette swaps with no JavaScript on the render path and nothing in React
 *   has to hold the value.
 *
 * The map page is not React at all and reads the same attribute and the same
 *   storage key, so a choice made here carries over to it and back.
 *
 * `ColorModeScript` applies the stored preference before first paint so there
 *   is no flash of the wrong theme. When no preference is stored the attribute
 *   is absent and the OS preference wins via `prefers-color-scheme`.
 */

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

function resolvedMode(): ResolvedColorMode {
  const mode = storedMode();
  if (mode !== "system") return mode;
  return darkMediaQuery().matches ? "dark" : "light";
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
}

/**
 * Flips to the opposite appearance, preferring "system" whenever that already
 * produces the appearance the user asked for. This way a user whose OS is set
 * to dark and who toggles light-then-dark ends up following their OS again
 * rather than being pinned to an explicit choice.
 *
 * public/map/map.js repeats this rule for the map page; the two have to agree
 * about what the toggle does.
 */
export function toggleColorMode() {
  const systemIsDark = darkMediaQuery().matches;

  if (resolvedMode() === "light") {
    setColorMode(systemIsDark ? "system" : "dark");
  } else {
    setColorMode(systemIsDark ? "light" : "system");
  }
}
