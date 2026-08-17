/**
 * @file The floating menu in the corner of every page.
 *
 * Loaded by every page, including the map, so there is one implementation of
 * the menu rather than one per page template.
 */

import { toggleColorMode } from "/js/theme.js";

// The plus rotates 90° into the cross as it opens; the swap is what makes the
// rotation read as a transformation rather than a spin.
const MENU_PATH = "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z";
const CLOSE_PATH =
  "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z";

const nav = document.querySelector(".nav");
const actions = nav?.querySelector(".nav-actions");
const toggle = nav?.querySelector(".nav-fab");
const fabPath = nav?.querySelector(".nav-fab-icon path");

export function closeNav() {
  setOpen(false);
}

function setOpen(open) {
  nav.dataset.open = String(open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  fabPath.setAttribute("d", open ? CLOSE_PATH : MENU_PATH);
  // The actions stay in the DOM so they can animate, but must not be reachable
  // by keyboard or screen reader while collapsed.
  actions.inert = !open;
}

if (nav) {
  setOpen(false);

  toggle.addEventListener("click", () => setOpen(nav.dataset.open !== "true"));

  nav.querySelector(".nav-theme")?.addEventListener("click", () => {
    toggleColorMode();
    closeNav();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || nav.dataset.open !== "true") return;
    closeNav();
    toggle.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (nav.dataset.open !== "true" || nav.contains(event.target)) return;
    closeNav();
  });
}
