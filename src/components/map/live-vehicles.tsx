import { memo, useEffect, useState } from "react";
import L from "leaflet";
import { Marker } from "react-leaflet";
import { Box } from "@mui/material";
import DirectionsBusIcon from "@mui/icons-material/DirectionsBus";
import { renderToString } from "react-dom/server";

import { VehiclePosition } from "@/types";

function vehicleIcon(routeColor: string, iconSize: number, bearing?: number) {
  const hasBearing = typeof bearing === "number";
  return L.divIcon({
    // Wrap the bus icon in a styled div (circle) for the outline and background
    html: renderToString(
      <Box
        style={{
          background: "white",
          border: "1px solid black",
          borderRadius: "50%",
          width: iconSize + 4,
          height: iconSize + 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <DirectionsBusIcon
          style={{
            stroke: "black",
            fill: routeColor || "black",
            width: iconSize,
            height: iconSize,
          }}
        />
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
                top: -6,
                left: "50%",
                width: 0,
                height: 0,
                transform: "translateX(-50%)",
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                borderBottom: "5px solid white",
                filter: `drop-shadow(0 0 1px ${routeColor})`,
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
        ({ vehicleId, route: { routeColor }, position, bearing }) => (
          <Marker
            key={vehicleId}
            position={position}
            icon={vehicleIcon(routeColor, iconSize, bearing)}
            // This looks a bit weird but it is better for the buses to be behind the stops
            //   so stops don't get hidden. -5 isn't enough but -10 seems to work
            zIndexOffset={-10}
          />
        )
      )}
    </>
  );
}

export const LiveVehicles = memo(LiveVehiclesRaw);
