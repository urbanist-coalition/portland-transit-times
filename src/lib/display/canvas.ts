/**
 * @file A 1-bit drawing surface, in the panel's own memory layout.
 *
 * There is no intermediate representation and no colour: the buffer this
 * writes into *is* the framebuffer the display takes over SPI, so drawing and
 * encoding are the same act. One byte is eight horizontally-adjacent pixels,
 * most-significant bit leftmost, row 0 at the top — the convention every
 * driver in this family expects.
 *
 * A *clear* bit is ink, which is the convention the UC8179-family drivers use:
 * their own sample code fills the buffer with 0xFF to clear the screen. Writing
 * it their way round is what lets the firmware stream this straight from the
 * socket into panel SRAM without touching a byte — and a buffer the device has
 * to invert first is a buffer that may as well have been a PNG.
 *
 * It is the one thing nothing in the file itself records, so it is stated here,
 * asserted in the tests, and written down in the notes the firmware is built
 * from. The methods below still speak in ink, so nothing that draws has to know.
 */

export class Bitmap1 {
  readonly stride: number;
  readonly data: Buffer;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.stride = Math.ceil(width / 8);
    // 0xFF is a blank page, exactly as the panel's own clear routine writes it.
    this.data = Buffer.alloc(this.stride * height, 0xff);
  }

  set(x: number, y: number, ink = true): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = y * this.stride + (x >> 3);
    const mask = 0x80 >> (x & 7);
    if (ink) this.data[index]! &= ~mask;
    else this.data[index]! |= mask;
  }

  get(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return (this.data[y * this.stride + (x >> 3)]! & (0x80 >> (x & 7))) === 0;
  }

  fill(x: number, y: number, w: number, h: number, ink = true): void {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) this.set(col, row, ink);
    }
  }

  /** A horizontal rule. The only line this layout ever needs. */
  rule(x: number, y: number, w: number, thickness = 1): void {
    this.fill(x, y, w, thickness);
  }

  /**
   * The frame as characters, for tests and for looking at in a terminal.
   *
   * A 1-bit image diffs perfectly as text, so a layout regression shows up in
   * a failing test as the thing that moved rather than as a changed hash.
   */
  toAscii(scale = 1): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y += scale) {
      let line = "";
      for (let x = 0; x < this.width; x += scale) {
        // Any ink in the cell darkens it, so thin strokes survive scaling down.
        let ink = false;
        for (let dy = 0; dy < scale && !ink; dy++) {
          for (let dx = 0; dx < scale && !ink; dx++) {
            if (this.get(x + dx, y + dy)) ink = true;
          }
        }
        line += ink ? "█" : "·";
      }
      lines.push(line);
    }
    return lines.join("\n");
  }
}
