import Link from "next/link";
import { useCallback, useMemo, useRef } from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { renderToString } from "react-dom/server";

import { useColorMode } from "@/components/color-mode";
import { Location, Stop } from "@/types";
import LinePill from "@/components/line-pill";

import styles from "./map.module.css";

// The ring drawn around each stop marker, picked to stay visible against both
//   the light and dark base maps.
const MARKER_OUTLINE = { light: "#616161", dark: "#c9d1d9" };

const generatePieSlices = (colors: string[], radius: number) => {
  const slicePaths = [];
  const center = radius;

  if (colors.length === 1) {
    // Single color: Fill entire circle
    slicePaths.push({
      color: colors[0],
      pathData: `M ${center} ${center} m -${radius}, 0 a ${radius},${radius} 0 1,0 ${radius * 2},0 a ${radius},${radius} 0 1,0 -${radius * 2},0`,
    });
  } else {
    // Multiple colors: Distribute evenly
    const total = colors.length;

    colors.forEach((color, index) => {
      const startAngle = ((index - 0.5) / total) * 2 * Math.PI; // Offset by 90 degrees
      const endAngle = ((index + 0.5) / total) * 2 * Math.PI;

      const startX = center + radius * Math.cos(startAngle);
      const startY = center + radius * Math.sin(startAngle);
      const endX = center + radius * Math.cos(endAngle);
      const endY = center + radius * Math.sin(endAngle);

      const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

      const pathData = `
        M ${center} ${center}
        L ${startX} ${startY}
        A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}
        Z
      `;

      slicePaths.push({ color, pathData });
    });
  }

  return slicePaths;
};

function StopIcon({
  colors,
  size,
  outlineColor = "black",
  outlineWidth = 4, // Reduced to make the outline more subtle
}: {
  colors: string[];
  size: number;
  outlineColor?: string;
  outlineWidth?: number;
}) {
  const radius = size / 2;
  const halfOutline = outlineWidth / 2;
  const innerRadius = radius - halfOutline; // Adjust for the outline width
  const slices = generatePieSlices(colors, innerRadius);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`${-halfOutline} ${-halfOutline} ${size + halfOutline} ${size + halfOutline}`}
    >
      {/* Thin Outline */}
      <circle
        cx={innerRadius}
        cy={innerRadius}
        r={innerRadius}
        fill="none"
        stroke={outlineColor}
        strokeWidth={outlineWidth}
      />

      {/* Pie Slices */}
      {slices.map((slice, index) => (
        <path key={index} d={slice.pathData} fill={slice.color} />
      ))}
    </svg>
  );
}

interface VisibleStopsProps {
  allStops: Record<string, Stop>;
  zoom: number;
  iconSize: number;
  center: Location;
}

export function VisibleStops({
  allStops,
  zoom,
  iconSize,
  center,
}: VisibleStopsProps) {
  const map = useMap();
  const { resolved } = useColorMode();

  // For some reason when the map is zoomed out the stops appear to be too low and to the left
  //   These values are picked to make the stops look good at these zoom levels
  //   They are X and Y
  //   - X bigger = left, smaller = right
  //   - Y bigger = up, smaller = down
  const zoonSkew: Record<number, [number, number]> = {
    13: [-2, 2],
    14: [-1, 1],
  };
  const [skewX, skewY] = zoonSkew[zoom] || [0, 0];

  const stopIconCache = useRef<Map<string, L.DivIcon>>(new Map());

  // Caches the stop icons to only render once per color combination
  //   Speed up rendering a lot
  const getStopIcon = useCallback(
    (colors: string[]) => {
      const key = colors.join("|") + iconSize + resolved;
      let icon = stopIconCache.current.get(key);
      if (!icon) {
        icon = L.divIcon({
          html: renderToString(
            <StopIcon
              colors={colors}
              size={iconSize}
              outlineColor={MARKER_OUTLINE[resolved]}
            />
          ),
          className: "",
          iconAnchor: [iconSize / 2 + skewX, iconSize / 2 + skewY],
        });
        stopIconCache.current.set(key, icon);
      }
      return icon;
    },
    [iconSize, skewX, skewY, resolved]
  );

  const visibleStops = useMemo(() => {
    if (zoom < 15) return [];
    const b = map.getBounds();
    return Object.values(allStops).filter((s) => b.contains(s.location));
    // 'zoom' and 'center' are used to rerun this whenver the map changes
    //   if they change map.getBounds() will change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStops, zoom, map, center]);

  return (
    <>
      {visibleStops.map((stop) => (
        <Marker
          riseOnHover={true}
          key={stop.stopId}
          position={stop.location}
          icon={getStopIcon(stop.routes.map((r) => r.routeColor))}
        >
          <Popup closeButton={false}>
            <div className={styles.popup}>
              <h2 className={styles.popupName}>{stop.stopName}</h2>
              <div className={styles.popupCode}>
                Stop Number: {stop.stopCode}
              </div>
              {stop.routes && stop.routes.length > 0 && (
                <div className={styles.popupRoutes}>
                  {stop.routes.map(
                    ({
                      routeId,
                      routeShortName,
                      routeColor,
                      routeTextColor,
                    }) => (
                      <LinePill
                        key={routeId}
                        lineName={routeShortName}
                        lineColor={routeColor}
                        lineTextColor={routeTextColor}
                      />
                    )
                  )}
                </div>
              )}
              <Link
                href={`/stops/${stop.stopCode}`}
                className={`btn btn-primary ${styles.popupAction}`}
              >
                View Arrivals
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
