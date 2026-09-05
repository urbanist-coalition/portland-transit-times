/**
 * A minimum TrueType rasterizer: enough of the format to turn a face into
 * 1-bit glyph bitmaps at a fixed pixel size. Build-time only.
 */
import { readFileSync } from "node:fs";

const u8  = (b, o) => b.readUInt8(o);
const u16 = (b, o) => b.readUInt16BE(o);
const i16 = (b, o) => b.readInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);

export function parse(path) {
  const b = readFileSync(path);
  const numTables = u16(b, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[b.toString("ascii", o, o + 4)] = { off: u32(b, o + 8), len: u32(b, o + 12) };
  }

  const head = tables.head.off;
  const unitsPerEm = u16(b, head + 18);
  const indexToLocFormat = i16(b, head + 50);
  const numGlyphs = u16(b, tables.maxp.off + 4);
  const numHMetrics = u16(b, tables.hhea.off + 34);

  // loca -> glyph offsets into glyf
  const loca = [];
  for (let i = 0; i <= numGlyphs; i++) {
    loca.push(indexToLocFormat
      ? u32(b, tables.loca.off + i * 4)
      : u16(b, tables.loca.off + i * 2) * 2);
  }

  // cmap format 4, the Windows BMP subtable
  const cmapOff = tables.cmap.off;
  let sub = 0;
  for (let i = 0; i < u16(b, cmapOff + 2); i++) {
    const rec = cmapOff + 4 + i * 8;
    const pid = u16(b, rec), eid = u16(b, rec + 2);
    if (pid === 3 && (eid === 1 || eid === 0)) sub = cmapOff + u32(b, rec + 4);
  }
  if (!sub) throw new Error("no unicode cmap");
  const segX2 = u16(b, sub + 6);
  const ends = sub + 14, starts = ends + segX2 + 2;
  const deltas = starts + segX2, ranges = deltas + segX2;

  const glyphFor = (code) => {
    for (let s = 0; s < segX2; s += 2) {
      if (u16(b, ends + s) < code) continue;
      if (u16(b, starts + s) > code) return 0;
      const ro = u16(b, ranges + s);
      if (ro === 0) return (code + i16(b, deltas + s)) & 0xffff;
      const gi = u16(b, ranges + s + ro + (code - u16(b, starts + s)) * 2);
      return gi === 0 ? 0 : (gi + i16(b, deltas + s)) & 0xffff;
    }
    return 0;
  };

  const advanceFor = (gid) => u16(b,
    tables.hmtx.off + (gid < numHMetrics ? gid * 4 : (numHMetrics - 1) * 4));

  /** Contours as arrays of {x,y,on}, in font units. */
  function contours(gid, depth = 0) {
    if (loca[gid] === loca[gid + 1] || depth > 4) return [];
    const g = tables.glyf.off + loca[gid];
    const n = i16(b, g);

    if (n < 0) {
      // Composite: accumulate the components' contours, offsets only.
      const out = [];
      let o = g + 10;
      for (;;) {
        const flags = u16(b, o), idx = u16(b, o + 2);
        o += 4;
        let dx, dy;
        if (flags & 1) { dx = i16(b, o); dy = i16(b, o + 2); o += 4; }
        else { dx = (u8(b, o) << 24) >> 24; dy = (u8(b, o + 1) << 24) >> 24; o += 2; }
        if (flags & 8) o += 2;
        else if (flags & 0x40) o += 4;
        else if (flags & 0x80) o += 8;
        if (!(flags & 2)) { dx = 0; dy = 0; }   // point matching: unsupported
        for (const c of contours(idx, depth + 1)) {
          out.push(c.map((p) => ({ x: p.x + dx, y: p.y + dy, on: p.on })));
        }
        if (!(flags & 0x20)) break;
      }
      return out;
    }

    const endPts = [];
    for (let i = 0; i < n; i++) endPts.push(u16(b, g + 10 + i * 2));
    const count = endPts[n - 1] + 1;
    let o = g + 10 + n * 2;
    o += 2 + u16(b, o);                        // skip hinting instructions

    const flags = [];
    while (flags.length < count) {
      const f = u8(b, o++);
      flags.push(f);
      if (f & 8) { let r = u8(b, o++); while (r-- > 0) flags.push(f); }
    }

    const read = (shortBit, sameBit) => {
      const vals = [];
      let v = 0;
      for (const f of flags) {
        if (f & shortBit) { const d = u8(b, o++); v += (f & sameBit) ? d : -d; }
        else if (!(f & sameBit)) { v += i16(b, o); o += 2; }
        vals.push(v);
      }
      return vals;
    };
    const xs = read(2, 16), ys = read(4, 32);

    const out = [];
    let start = 0;
    for (const end of endPts) {
      const pts = [];
      for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      out.push(pts);
      start = end + 1;
    }
    return out;
  }

  return { unitsPerEm, glyphFor, advanceFor, contours };
}

/** Quadratic contours -> flat polygons, with TrueType's implied on-curve midpoints. */
function flatten(cs, scale, steps = 8) {
  const polys = [];
  for (const pts of cs) {
    if (!pts.length) continue;
    // Rotate so the contour starts on-curve.
    let s = pts.findIndex((p) => p.on);
    const seq = s === -1
      ? [{ x: (pts[0].x + pts.at(-1).x) / 2, y: (pts[0].y + pts.at(-1).y) / 2, on: true }, ...pts]
      : [...pts.slice(s), ...pts.slice(0, s)];

    const poly = [];
    const push = (x, y) => poly.push([x * scale, y * scale]);
    push(seq[0].x, seq[0].y);
    let i = 1;
    let cur = seq[0];
    while (i <= seq.length) {
      const p = seq[i % seq.length];
      if (p.on) { push(p.x, p.y); cur = p; i++; continue; }
      const nxt = seq[(i + 1) % seq.length];
      const end = nxt.on ? nxt : { x: (p.x + nxt.x) / 2, y: (p.y + nxt.y) / 2 };
      for (let t = 1; t <= steps; t++) {
        const u = t / steps, v = 1 - u;
        push(v * v * cur.x + 2 * v * u * p.x + u * u * end.x,
             v * v * cur.y + 2 * v * u * p.y + u * u * end.y);
      }
      cur = end;
      i += nxt.on ? 2 : 1;
    }
    polys.push(poly);
  }
  return polys;
}

/**
 * One glyph as a 1-bit bitmap. Supersampled coverage thresholded at half,
 * which is what keeps stems solid and edges from turning to grey mush.
 */
export function raster(font, code, pxSize, ss = 4) {
  const gid = font.glyphFor(code);
  const scale = pxSize / font.unitsPerEm;
  const polys = flatten(font.contours(gid), scale);
  const advance = Math.round(font.advanceFor(gid) * scale);

  if (!polys.length) return { advance, w: 0, h: 0, top: 0, left: 0, bits: [] };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const left = Math.floor(x0), top = Math.ceil(y1);
  const w = Math.ceil(x1) - left + 1, h = top - Math.floor(y0) + 1;

  const edges = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b2 = p[(i + 1) % p.length];
      if (a[1] !== b2[1]) edges.push([a[0], a[1], b2[0], b2[1]]);
    }
  }

  const cov = new Float32Array(w * h);
  const inc = 1 / (ss * ss);
  for (let py = 0; py < h; py++) {
    for (let sy = 0; sy < ss; sy++) {
      // Sample centre, in glyph space (y grows upward in a font).
      const y = top - py - (sy + 0.5) / ss;
      const xs = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push([ax + ((y - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
        }
      }
      if (!xs.length) continue;
      xs.sort((a, b2) => a[0] - b2[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (wind === 0) continue;
        const from = xs[k][0], to = xs[k + 1][0];
        for (let px = 0; px < w; px++) {
          for (let sx = 0; sx < ss; sx++) {
            const x = left + px + (sx + 0.5) / ss;
            if (x >= from && x < to) cov[py * w + px] += inc;
          }
        }
      }
    }
  }

  const bits = [];
  for (let py = 0; py < h; py++) {
    let row = "";
    for (let px = 0; px < w; px++) row += cov[py * w + px] >= 0.5 ? "1" : "0";
    bits.push(row);
  }
  return { advance, w, h, top, left, bits };
}
