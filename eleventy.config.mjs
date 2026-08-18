/**
 * Eleventy builds the site's HTML: one file per page, no client runtime, no
 * bundler. Templates live in `site/`, assets in `public/`, output in `_site/`.
 *
 * ESM so it can import the browser's own modules — public/js/package.json
 * marks that directory as ESM for Node, which is what lets the build, the
 * worker and the browser share code without a bundler in between.
 *
 * The only thing Eleventy is asked to do is templating — layouts and includes
 * so the header, the menu and the footer exist once. Everything interactive is
 * a plain ES module under public/js/ that the browser loads directly.
 */

import { contrastText, isTooDark, isTooLight } from "./public/js/colors.js";
import { formatClock, renderTripCalls } from "./public/js/render-trip.js";
import { compareRouteNames } from "./public/js/routes.js";
import { tripSlug } from "./public/js/trips.js";

export default function (eleventyConfig) {
  // `public/` is served verbatim at the site root: stylesheets, the ES modules,
  // the favicons, and the map page with its vendored MapLibre. Copying the
  // whole directory means adding an asset never means editing this file.
  eleventyConfig.addPassthroughCopy({ public: "." });

  // Assets change without templates changing, so a rebuild has to notice.
  eleventyConfig.addWatchTarget("public/");

  // The stop list the search box and the quick stops chips read, trimmed to
  // the two fields they use and flattened to pairs — the difference between
  // 25 KB and 200 KB inlined into the home page.
  eleventyConfig.addFilter("stopIndex", (stops) =>
    stops.map((stop) => [stop.stopCode, stop.stopName])
  );

  // Route colours come from the feed, so the pills on a stop page have to be
  // styled inline — and by the same rules the browser applies elsewhere. Both
  // filters are the shared module, not a second implementation.
  eleventyConfig.addFilter("contrastText", contrastText);
  eleventyConfig.addFilter("tooLight", (color) => isTooLight(color));
  eleventyConfig.addFilter("tooDark", (color) => isTooDark(color));

  // The feed lists a stop's routes in whatever order it pleases. Riders read
  // them in service order, and the map popups use the same comparator.
  eleventyConfig.addFilter("sortRoutes", (routes) =>
    [...(routes || [])].sort((a, b) =>
      compareRouteNames(a.routeShortName, b.routeShortName)
    )
  );

  // Where a trip's page lives. One definition, shared with the browser, so a
  // link written into an arrivals card lands on the page this built.
  eleventyConfig.addFilter("tripSlug", tripSlug);

  // A trip's stops, from the module that will later redraw them with live
  // times in it. Unlike the arrivals, a timetable does not depend on when it
  // is rendered, so the build can write this one out and be done.
  eleventyConfig.addFilter("tripCalls", (calls) => renderTripCalls(calls));

  // "11:35:00" as a rider reads it. Same function the rows use.
  eleventyConfig.addFilter("clock", formatClock);

  return {
    dir: {
      input: "site",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
}
