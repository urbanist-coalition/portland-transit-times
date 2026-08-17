/**
 * @file Service alerts.
 *
 * The only page content that is neither static nor per-second: alerts change a
 * few times a week, so they are fetched once on load rather than built into
 * the page (which would freeze them until the nightly rebuild) or polled.
 *
 * Both states are already in the markup — see _includes/alerts.njk — so this
 * fills in a count and some text and swaps which one is visible. A failed
 * fetch leaves the "0" state showing, which is the same thing a rider sees on
 * a normal day.
 */

const ENDPOINT = "/data/alerts.json";

const root = document.getElementById("service-alerts");
const emptyState = root?.querySelector(".alerts-empty");
const fullState = root?.querySelector(".alerts-full");
const badge = fullState?.querySelector(".alerts-badge");
const list = fullState?.querySelector(".alerts-list");

function alertItem({ headerText, descriptionText }) {
  const item = document.createElement("li");
  item.className = "alerts-alert";

  const header = document.createElement("p");
  header.className = "alerts-alert-header";
  header.textContent = headerText;
  item.append(header);

  if (descriptionText) {
    const body = document.createElement("p");
    body.className = "alerts-alert-body";
    body.textContent = descriptionText;
    item.append(body);
  }
  return item;
}

async function load() {
  const response = await fetch(ENDPOINT);
  if (!response.ok) return;

  const alerts = await response.json();
  if (!Array.isArray(alerts) || alerts.length === 0) return;

  badge.textContent = String(alerts.length);
  list.replaceChildren(...alerts.map(alertItem));
  emptyState.hidden = true;
  fullState.hidden = false;
}

if (root) load().catch(() => {});
