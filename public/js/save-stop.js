/**
 * @file The save star on a stop page, and the recently-viewed list.
 *
 * Which star shows is decided in CSS from `aria-pressed`, so this only has to
 * set that attribute — the page is served to everyone alike and cannot know
 * whose stop is saved until it is in the browser.
 */

import { addRecent, isSaved, toggleSaved } from "/js/stop-store.js";

const button = document.querySelector(".save-stop");
const stopCode = button?.dataset.stopCode;

function describe(saved) {
  button.setAttribute("aria-pressed", String(saved));
  const label = saved ? "Remove from saved stops" : "Save this stop";
  button.setAttribute("aria-label", label);
  button.title = label;
}

if (button && stopCode) {
  describe(isSaved(stopCode));

  button.addEventListener("click", () => describe(toggleSaved(stopCode)));

  // Viewing a stop makes it recent — unless it is already saved, which would
  // spend the quick stops budget on the same stop twice.
  if (!isSaved(stopCode)) addRecent(stopCode);
}
