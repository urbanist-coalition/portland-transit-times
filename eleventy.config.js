/**
 * Eleventy builds the site's HTML: one file per page, no client runtime, no
 * bundler. Templates live in `site/`, assets in `public/`, output in `_site/`.
 *
 * The only thing Eleventy is asked to do is templating — layouts and includes
 * so the header, the menu and the footer exist once. Everything interactive is
 * a plain ES module under public/js/ that the browser loads directly.
 */

module.exports = function (eleventyConfig) {
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
};
