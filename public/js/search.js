/**
 * @file The stop search box: a combobox over every stop, entirely local.
 *
 * The whole stop list is already in the page, so searching is a scan over ~650
 * pairs on each keystroke — microseconds, no network, works before the rest of
 * the page has finished loading.
 */

import { stops } from "/js/stops.js";

/** Rendering every stop would be slow and useless — nobody scrolls 500 rows. */
const MAX_RESULTS = 30;
/** How many of the top results get their page warmed up ahead of a click. */
const PREFETCH_COUNT = 5;

const root = document.querySelector(".search");
const field = root?.querySelector(".search-field");
const input = root?.querySelector(".search-input");
const clear = root?.querySelector(".search-clear");
const list = root?.querySelector(".search-list");
const empty = root?.querySelector(".search-empty");
const optionTemplate = document.getElementById("search-option");

let results = [];
let activeIndex = 0;
let open = false;

/**
 * Lower is better. Ranks so that typing a stop number puts that exact stop
 * first, and typing a street name puts stops starting with it above stops that
 * merely mention it.
 */
function score(code, name, query) {
  const lowerCode = code.toLowerCase();
  const lowerName = name.toLowerCase();

  if (lowerCode === query) return 0;
  if (lowerCode.startsWith(query)) return 1;
  if (lowerName.startsWith(query)) return 2;
  // A match at the start of any word, e.g. "congress" in "Elm at Congress"
  if (
    new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(
      lowerName
    )
  )
    return 3;
  if (lowerName.includes(query)) return 4;
  return null;
}

function search(query) {
  const scored = [];
  for (const [code, name] of stops) {
    const rank = score(code, name, query);
    if (rank !== null) scored.push({ code, name, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code))
    .slice(0, MAX_RESULTS);
}

/** Fills an element with the text, with the matched run wrapped in a <mark>. */
function highlight(element, text, query) {
  const at = text.toLowerCase().indexOf(query);
  if (at === -1) {
    element.textContent = text;
    return;
  }
  const mark = document.createElement("mark");
  mark.className = "search-mark";
  mark.textContent = text.slice(at, at + query.length);
  element.replaceChildren(
    text.slice(0, at),
    mark,
    text.slice(at + query.length)
  );
}

function optionId(code) {
  return `search-option-${code}`;
}

function stopUrl(code) {
  return `/stops/${encodeURIComponent(code)}/`;
}

function setActive(index) {
  activeIndex = index;
  for (const [i, option] of [...list.children].entries()) {
    option.setAttribute("aria-selected", String(i === index));
  }
  const active = list.children[index];
  if (!active) return;
  input.setAttribute("aria-activedescendant", active.id);
  // Keep the highlighted row visible while arrowing through a long list
  active.scrollIntoView({ block: "nearest" });
}

/**
 * Warms up the pages most likely to be opened next. They are static files, so
 * the browser can have them in hand before the click.
 */
let prefetchTimer = null;
const prefetched = new Set();
function prefetch() {
  window.clearTimeout(prefetchTimer);
  prefetchTimer = window.setTimeout(() => {
    for (const { code } of results.slice(0, PREFETCH_COUNT)) {
      if (prefetched.has(code)) continue;
      prefetched.add(code);
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = stopUrl(code);
      document.head.append(link);
    }
  }, 150);
}

function render() {
  const query = input.value.trim().toLowerCase();
  results = query ? search(query) : [];

  const expanded = open && results.length > 0;
  field.dataset.expanded = String(expanded);
  input.setAttribute("aria-expanded", String(expanded));
  list.hidden = !expanded;
  clear.hidden = input.value === "";

  empty.hidden = !(open && query && results.length === 0);
  if (!empty.hidden)
    empty.textContent = `No stops match “${input.value.trim()}”.`;

  if (!expanded) {
    list.replaceChildren();
    input.removeAttribute("aria-activedescendant");
    return;
  }

  const options = results.map(({ code, name }) => {
    const option = optionTemplate.content.cloneNode(true).firstElementChild;
    option.id = optionId(code);
    option.dataset.code = code;
    highlight(option.querySelector(".search-option-code"), code, query);
    highlight(option.querySelector(".search-option-name"), name, query);
    return option;
  });
  list.replaceChildren(...options);

  setActive(Math.min(activeIndex, results.length - 1));
  prefetch();
}

function go(code) {
  if (code) window.location.assign(stopUrl(code));
}

if (root) {
  input.addEventListener("input", () => {
    open = true;
    activeIndex = 0;
    render();
  });

  input.addEventListener("focus", () => {
    open = true;
    render();
  });

  input.addEventListener("keydown", (event) => {
    const count = results.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        open = true;
        activeIndex = count ? (activeIndex + 1) % count : 0;
        render();
        break;
      case "ArrowUp":
        event.preventDefault();
        open = true;
        activeIndex = count ? (activeIndex - 1 + count) % count : 0;
        render();
        break;
      case "Enter":
        if (open && results[activeIndex]) {
          event.preventDefault();
          go(results[activeIndex].code);
        }
        break;
      case "Escape":
        if (open && count) {
          open = false;
        } else if (input.value) {
          input.value = "";
        }
        render();
        break;
    }
  });

  clear.addEventListener("click", () => {
    input.value = "";
    input.focus();
    render();
  });

  // Clicking a result must not take focus off the input, or the combobox loses
  // its keyboard state between the press and the click.
  list.addEventListener("mousedown", (event) => event.preventDefault());

  list.addEventListener("click", (event) => {
    go(event.target.closest(".search-option")?.dataset.code);
  });

  list.addEventListener("mousemove", (event) => {
    const option = event.target.closest(".search-option");
    if (option) setActive([...list.children].indexOf(option));
  });

  document.addEventListener("pointerdown", (event) => {
    if (!open || root.contains(event.target)) return;
    open = false;
    render();
  });
}
