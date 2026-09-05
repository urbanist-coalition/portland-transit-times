/**
 * @file The frame, as bytes on the wire.
 *
 * Two encodings of the same pixels, because they answer to two different
 * readers.
 *
 * `.bin` is the framebuffer and nothing else — no header, no length, no
 * metadata — which is what lets a microcontroller stream it from the socket
 * straight into the panel's SRAM without a decoder or a spare 48 KB of RAM.
 * The cost is that it describes none of its own conventions, so they are
 * written down instead: MSB first, row 0 at the top, a clear bit is ink.
 *
 * `.bmp` is those same bytes behind a 62-byte header that states all three, so
 * a browser can open it. It exists so that the conventions above can be
 * checked by looking rather than by reflashing.
 */

import { Bitmap1 } from "./canvas";

/** The framebuffer, exactly. 48,000 bytes at 800x480, whatever is drawn on it. */
export function toBin(bitmap: Bitmap1): Buffer {
  return Buffer.from(bitmap.data);
}

const FILE_HEADER = 14;
const INFO_HEADER = 40;
const PALETTE = 8;
const OFFSET = FILE_HEADER + INFO_HEADER + PALETTE;

/**
 * The same pixels as a 1-bit BMP.
 *
 * Written top-down via a negative height, so the byte order matches the panel
 * rather than BMP's usual bottom-up convention — the point of this file is to
 * show what the device will show, and a preview that is upside down relative to
 * the hardware would be worse than no preview.
 *
 * At 800 wide a row is 100 bytes, which is already a multiple of four, so no
 * row padding is involved. A profile whose width is not a multiple of 32 would
 * need it.
 */
export function toBmp(bitmap: Bitmap1): Buffer {
  const padded = Math.ceil(bitmap.stride / 4) * 4;
  const pixels = padded * bitmap.height;
  const out = Buffer.alloc(OFFSET + pixels);

  out.write("BM", 0, "ascii");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(OFFSET, 10);

  out.writeUInt32LE(INFO_HEADER, 14);
  out.writeInt32LE(bitmap.width, 18);
  out.writeInt32LE(-bitmap.height, 22); // negative: rows top-down
  out.writeUInt16LE(1, 26); // planes
  out.writeUInt16LE(1, 28); // bits per pixel
  out.writeUInt32LE(0, 30); // BI_RGB
  out.writeUInt32LE(pixels, 34);
  out.writeUInt32LE(2835, 38); // ~72 dpi, in pixels per metre
  out.writeUInt32LE(2835, 42);
  out.writeUInt32LE(2, 46); // colours used
  out.writeUInt32LE(2, 50); // all of them significant

  // Index 0 is ink, index 1 is paper — matching "a clear bit is ink" above.
  // These two entries are the only thing that has to move when the polarity
  // does; the pixel data stays a byte-exact copy of the .bin either way.
  out.writeUInt32LE(0x00000000, 54);
  out.writeUInt32LE(0x00ffffff, 58);

  for (let y = 0; y < bitmap.height; y++) {
    bitmap.data.copy(
      out,
      OFFSET + y * padded,
      y * bitmap.stride,
      (y + 1) * bitmap.stride
    );
  }
  return out;
}
