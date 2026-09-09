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

import { activeAlerts, alertsForStop } from "/js/alert-rules.js";

const ENDPOINT = "/data/alerts.json";

const root = document.getElementById("service-alerts");
const emptyState = root?.querySelector(".alerts-empty");
const fullState = root?.querySelector(".alerts-full");
const badge = fullState?.querySelector(".alerts-badge");
const list = fullState?.querySelector(".alerts-list");

/**
 * The stop this page is about, or null on the home page — see alerts.njk.
 *
 * A stop page asks only for the alerts that concern its stop; the home page,
 * which is about nowhere in particular, asks for all of them.
 */
const stop = root?.dataset.stopId
  ? {
      stopId: root.dataset.stopId,
      routeIds: (root.dataset.routeIds || "").split(",").filter(Boolean),
    }
  : null;

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

  /*
   * Filtered by the clock, not taken as given. The feed carries alerts that
   * have not started and alerts that finished weeks ago — a producer keeps an
   * entity around until someone deletes it — and until this filter existed
   * both were shown as though they were happening now.
   *
   * Done here rather than in the worker so the answer is right for the moment
   * it is read: alerts.json is rewritten only when it changes, so an alert that
   * comes into force at nine o'clock would otherwise wait for the next edit to
   * the file, which on a quiet week is days.
   */
  const body = await response.json();
  const now = Date.now();
  const alerts = stop
    ? alertsForStop(body, stop, now)
    : activeAlerts(body, now);
  if (alerts.length === 0) return;

  badge.textContent = String(alerts.length);
  list.replaceChildren(...alerts.map(alertItem));
  emptyState.hidden = true;
  fullState.hidden = false;
}

if (root) load().catch(() => {});
