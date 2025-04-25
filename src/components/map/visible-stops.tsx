import Link from "next/link";
import { useCallback, useMemo, useRef } from "react";
import { Box, Button, Stack, Typography, useTheme } from "@mui/material";
import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { renderToString } from "react-dom/server";

import { Location, Stop } from "@/types";
import LinePill from "@/components/line-pill";

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
  const theme = useTheme();

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
      const key = colors.join("|") + iconSize + theme.palette.mode;
      let icon = stopIconCache.current.get(key);
      if (!icon) {
        icon = L.divIcon({
          html: renderToString(
            <StopIcon
              colors={colors}
              size={iconSize}
              outlineColor={theme.palette.grey[700]}
            />
          ),
          className: "",
          iconAnchor: [iconSize / 2 + skewX, iconSize / 2 + skewY],
        });
        stopIconCache.current.set(key, icon);
      }
      return icon;
    },
    [iconSize, skewX, skewY, theme.palette.mode, theme.palette.grey]
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
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h6" color="textPrimary">
                {stop.stopName}
              </Typography>
              <Typography variant="caption" color="textPrimary">
                Stop Number: {stop.stopCode}
              </Typography>
              <br />
              {stop.routes && stop.routes.length > 0 && (
                <Stack
                  direction="row"
                  spacing={1}
                  m={1}
                  justifyContent="center"
                >
                  {stop.routes.map(
                    ({ routeId, routeShortName, routeColor }) => {
                      return (
                        <LinePill
                          key={routeId}
                          lineName={routeShortName}
                          lineColor={routeColor}
                        />
                      );
                    }
                  )}
                </Stack>
              )}
              <Link href={`/stops/${stop.stopCode}`}>
                <Button variant="text">View Arrivals</Button>
              </Link>
            </Box>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
