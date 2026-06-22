import { memo, useEffect, useState } from "react";
import L from "leaflet";
import { Marker } from "react-leaflet";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { renderToString } from "react-dom/server";

import { VehiclePosition } from "@/types";

function vehicleIcon(
  routeColor: string,
  routeTextColor: string,
  routeShortName: string,
  iconSize: number,
  mode: "light" | "dark",
  bearing?: number
) {
  const hasBearing = typeof bearing === "number";
  const borderColor = mode === "dark" ? "white" : "black";
  return L.divIcon({
    html: renderToString(
      <Box
        style={{
          background: routeColor || "white",
          border: `1px solid ${borderColor}`,
          borderRadius: "50%",
          width: iconSize + 4,
          height: iconSize + 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <span
          style={{
            color: routeTextColor || "white",
            fontWeight: "bold",
            fontSize: Math.max(
              iconSize * (routeIcon(routeShortName).length === 1 ? 0.65 : 0.45),
              9
            ),
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {routeIcon(routeShortName)}
        </span>
        {hasBearing && (
          // GTFS bearing is degrees CW from true north; with a north-up map,
          // rotating the arrow by `bearing` from "up" points it the right way.
          <Box
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              transform: `rotate(${bearing}deg)`,
              transformOrigin: "center",
              pointerEvents: "none",
            }}
          >
            <Box
              style={{
                position: "absolute",
                top: -10,
                left: "50%",
                width: 0,
                height: 0,
                transform: "translateX(-50%)",
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderBottom: `9px solid ${routeColor || "black"}`,
                filter: `drop-shadow(0 0 1px ${borderColor})`,
              }}
            />
          </Box>
        )}
      </Box>
    ),
    className: "", // Important for a transparent background in Leaflet
  });
}

function LiveVehiclesRaw({ iconSize }: { iconSize: number }) {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const theme = useTheme();

  useEffect(() => {
    const interval = setInterval(async () => {
      const resp = await fetch("/api/vehicle-positions", {
        headers: {
          // This fixed an issue where it was always being cached
          // and it actually works, the response is actually cached
          // based on the Last-Modified header from the server.
          "Cache-Control": "no-cache",
        },
      });
      if (resp.status === 304) return; // No new data

      const vehiclePositions = await resp.json();
      setVehicles(vehiclePositions);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {vehicles.map(
        ({
          vehicleId,
          route: { routeColor, routeTextColor, routeShortName },
          position,
          bearing,
        }) => (
          <Marker
            key={vehicleId}
            position={position}
            icon={vehicleIcon(
              routeColor,
              routeTextColor,
              routeShortName,
              iconSize,
              theme.palette.mode,
              bearing
            )}
            // This looks a bit weird but it is better for the buses to be behind the stops
            //   so stops don't get hidden. -5 isn't enough but -10 seems to work
            zIndexOffset={-10}
          />
        )
      )}
    </>
  );
}

function routeIcon(routeShortName: string) {
  if (routeShortName === "HSK") return "H";
  if (routeShortName === "BRZ") return "B";
  return routeShortName;
}

export const LiveVehicles = memo(LiveVehiclesRaw);
