/**
 * @file Installs the service worker.
 *
 * Registration waits for the page to load, so it never competes with the
 * first paint, and for activation, so a prerendered page nobody opens does
 * not do it.
 */

import { whenActivated } from "/js/activation.js";

if ("serviceWorker" in navigator) {
  whenActivated(() => {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) => console.error("service worker registration:", error));
    });
  });
}
