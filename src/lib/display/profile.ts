/**
 * @file The panels we render for.
 *
 * Geometry is data rather than a constant, because it is the part of this that
 * a second display model changes and nothing else is. It is also what the URL
 * carries — /stops/<code>/display/<device>/display.bin — so a new entry here is
 * a new directory rather than a renegotiation with whoever wrote the firmware.
 */

export interface DisplayProfile {
  /** The slug in the URL. */
  id: string;
  /** For the notes we hand the hardware side. */
  model: string;
  width: number;
  height: number;
  /** Arrival rows the layout has room for. */
  rows: number;
  /**
   * How often the worker is allowed to rewrite this panel's frame.
   *
   * A bound on staleness, not on flashing. What it buys is that the frame a
   * panel is handed was drawn at most this long ago; what it costs is a render,
   * which is half a millisecond.
   *
   * How often the panel actually *redraws* is not set here and cannot be — it
   * is the firmware's polling interval, crossed with whether the poll came back
   * 200 or 304. That distinction matters because the redraw is the expensive
   * half: the panel has no partial refresh, so every one is four seconds of
   * flashing black and white in front of whoever is waiting. Rewriting the file
   * more often than the hardware asks for it is free; asking for it more often
   * than a rider would want to watch it flash is not.
   */
  refreshSeconds: number;
  /**
   * The longest a frame may stand unchanged before it is redrawn anyway.
   *
   * A panel showing the right times and a panel whose worker died three hours
   * ago look identical, and the frame's own "as of" line is the only thing that
   * separates them. Redrawing on a slow heartbeat keeps that line moving while
   * anything is alive, so a rider can tell a quiet stop from a stopped one —
   * at a cost of one refresh an hour when genuinely nothing is happening.
   */
  maxFrameAgeSeconds: number;
}

/**
 * Good Display's wide-temperature 7.5", which is the one that matters here:
 * ordinary e-paper is rated to 0°C and would be a blank rectangle for a good
 * part of a Portland winter. This one is rated to -25°C.
 *
 * 800 x 480 at 1 bit is 100 bytes a row and 48,000 bytes a frame, always —
 * a packed framebuffer has no compression and so no content-dependent size.
 */
export const GDEM075T41WT: DisplayProfile = {
  id: "gdem075t41wt",
  model: "Good Display GDEM075T41WT",
  width: 800,
  height: 480,
  rows: 6,
  refreshSeconds: 30,
  maxFrameAgeSeconds: 3600,
};

export const PROFILES: Record<string, DisplayProfile> = {
  [GDEM075T41WT.id]: GDEM075T41WT,
};
