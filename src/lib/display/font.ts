/**
 * @file Text, as blitted bitmaps.
 *
 * The glyphs were thresholded to 1 bit when the atlas was baked, so there is
 * nothing to rasterize here and nothing to antialias: drawing a string is
 * copying bits. That is what keeps this cheap enough to sit in the worker's
 * once-a-second pass beside every stop page on the site.
 *
 * Widths are therefore exact rather than estimated, which is the whole reason
 * truncation and centring below are arithmetic instead of layout. See
 * scripts/build-font-atlas.mjs for what produced the table.
 */

import { Bitmap1 } from "./canvas";
import { ATLAS } from "./atlas";

export interface Glyph {
  /** Pen advance, in pixels. */
  a: number;
  w: number;
  h: number;
  /** Rows above the baseline that the bitmap's first row sits at. */
  t: number;
  /** Left side bearing. */
  l: number;
  /** Rows packed MSB-first, base64. */
  b: string;
}

export interface Face {
  source: string;
  size: number;
  ascent: number;
  descent: number;
  glyphs: Record<string, Glyph>;
}

export interface Atlas {
  generated: string;
  faces: Record<string, Face>;
}

export type FaceName = "title" | "row" | "time" | "badge" | "small";

const decoded = new Map<string, Buffer>();

function bitmapOf(glyph: Glyph): Buffer {
  let buffer = decoded.get(glyph.b);
  if (!buffer) {
    buffer = Buffer.from(glyph.b, "base64");
    decoded.set(glyph.b, buffer);
  }
  return buffer;
}

export function face(name: FaceName): Face {
  const found = ATLAS.faces[name];
  if (!found) throw new Error(`no face "${name}" in the atlas`);
  return found;
}

/** The glyph for a character, falling back to "?" for anything unbaked. */
function glyphOf(f: Face, character: string): Glyph {
  return (
    f.glyphs[String(character.charCodeAt(0))] ??
    f.glyphs[String("?".charCodeAt(0))]!
  );
}

export function measure(name: FaceName, text: string): number {
  const f = face(name);
  let width = 0;
  for (const character of text) width += glyphOf(f, character).a;
  return width;
}

/**
 * The string, shortened with an ellipsis until it fits.
 *
 * Stop names are the reason this exists: "Congress St + Frederic St" fits and
 * "Portland Transportation Center - Concord Coach" does not, and a name that
 * runs off the edge of a panel is worse than one that admits it was cut.
 */
export function truncate(name: FaceName, text: string, max: number): string {
  if (measure(name, text) <= max) return text;
  const ellipsis = measure(name, "…");
  let out = "";
  let width = 0;
  for (const character of text) {
    const next = width + measure(name, character);
    if (next + ellipsis > max) break;
    out += character;
    width = next;
  }
  return `${out.trimEnd()}…`;
}

export interface TextOptions {
  /** Where `x` is measured from. Default "left". */
  align?: "left" | "center" | "right";
  /** Paper on ink rather than ink on paper — the route badges. */
  invert?: boolean;
  /** Truncate to this width, with an ellipsis, before drawing. */
  max?: number;
}

/**
 * Draws a string with its baseline at `y`.
 *
 * Baseline rather than top, because rows on this panel align on the baseline —
 * a destination and a time in different sizes have to sit on the same line, and
 * aligning their boxes instead makes them visibly disagree.
 *
 * Returns the advance width, so a caller placing something after it does not
 * have to measure again.
 */
export function drawText(
  target: Bitmap1,
  name: FaceName,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {}
): number {
  const f = face(name);
  const shown = options.max ? truncate(name, text, options.max) : text;
  const width = measure(name, shown);

  let pen = x;
  if (options.align === "center") pen = x - Math.round(width / 2);
  else if (options.align === "right") pen = x - width;

  for (const character of shown) {
    const glyph = glyphOf(f, character);
    if (glyph.w && glyph.h) {
      const bits = bitmapOf(glyph);
      const stride = Math.ceil(glyph.w / 8);
      for (let row = 0; row < glyph.h; row++) {
        for (let column = 0; column < glyph.w; column++) {
          const on =
            (bits[row * stride + (column >> 3)]! & (0x80 >> (column & 7))) !==
            0;
          if (on)
            target.set(
              pen + glyph.l + column,
              y - glyph.t + row,
              !options.invert
            );
        }
      }
    }
    pen += glyph.a;
  }
  return width;
}
