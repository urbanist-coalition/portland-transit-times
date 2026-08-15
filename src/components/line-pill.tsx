import { contrastText, isTooLight } from "@/lib/utils";

import styles from "./line-pill.module.css";

interface LinePillProps {
  lineName: string;
  lineColor: string;
  /**
   * The route's own text color from the GTFS feed. The agency picks this
   * deliberately — route 5 (#00B050), for instance, is specified as white text
   * even though a pure contrast calculation would land on black.
   */
  lineTextColor?: string;
}

export default function LinePill({
  lineName,
  lineColor,
  lineTextColor,
}: LinePillProps) {
  return (
    <span
      className={styles.pill}
      // Route colors come from the GTFS feed, so they can only be applied inline
      style={{
        backgroundColor: lineColor,
        // Fall back to a contrast calculation only when the feed omits a color
        color: lineTextColor || contrastText(lineColor),
        // Very light routes need an outline or they vanish against the surface
        borderColor: isTooLight(lineColor) ? "currentColor" : "transparent",
      }}
    >
      {lineName}
    </span>
  );
}
