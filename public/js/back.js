/**
 * @file The back button in page headers.
 *
 * history.back() is the whole feature, with one wrinkle: a page opened
 * directly — from a shared link, a bookmark, the home screen — has nothing to
 * go back to, and the button would do nothing at all. Those land on the home
 * page instead.
 */

for (const button of document.querySelectorAll("[data-back]")) {
  button.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  });
}
