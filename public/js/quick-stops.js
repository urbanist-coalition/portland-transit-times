/**
 * @file The saved and recent stop chips on the home page.
 *
 * Rendered from cookies at load rather than built into the HTML, because the
 * page is one file served to everyone — the rider's own stops cannot be baked
 * into it. The section stays hidden until there is something to show, so a
 * first visit sees nothing appear and disappear.
 *
 * The chip markup comes from <template> elements in the page rather than from
 * strings here, which keeps the icons in _data/icons.json where every other
 * icon lives.
 */

import { stopNames } from "/js/stops.js";
import { MAX_QUICK_STOPS, recentStops, savedStops } from "/js/stop-store.js";

const section = document.querySelector(".quick");
const list = section?.querySelector(".quick-list");
const templates = {
  saved: document.getElementById("quick-chip-saved"),
  recent: document.getElementById("quick-chip-recent"),
};

function chip(stopCode, kind) {
  const item = templates[kind].content.cloneNode(true);
  item.querySelector(".quick-chip").href =
    `/stops/${encodeURIComponent(stopCode)}/`;
  item.querySelector(".quick-chip-code").textContent = stopCode;
  item.querySelector(".quick-chip-name").textContent = stopNames.get(stopCode);
  return item;
}

function render() {
  // A stop can outlive the cookie that remembers it — dropped from the feed,
  // renumbered — and there is no page to link to when it does.
  const saved = savedStops().filter((code) => stopNames.has(code));
  const recent = recentStops()
    .filter((code) => stopNames.has(code) && !saved.includes(code))
    .slice(0, Math.max(0, MAX_QUICK_STOPS - saved.length));

  list.replaceChildren();
  section.hidden = saved.length === 0 && recent.length === 0;
  if (section.hidden) return;

  for (const code of saved) list.append(chip(code, "saved"));
  for (const code of recent) list.append(chip(code, "recent"));
}

if (section && list) {
  render();

  // Coming back from a stop page usually restores this one from the
  // back/forward cache, which does not re-run the module — so the chips would
  // still show what the cookies said before that stop was visited or saved.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) render();
  });
}
