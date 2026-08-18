/**
 * @file Escaping, for the renderers that build HTML as strings.
 *
 * Both of them run in Node as well as in the browser, so neither can reach for
 * the DOM to do this — and both put feed text (stop names, headsigns, colours)
 * into markup. One escaper, so there is one thing to be right.
 */

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );
}
