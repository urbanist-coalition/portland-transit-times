import { memo, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Marker } from "react-leaflet";
import { Box } from "@mui/material";
import { DirectionsBus } from "@mui/icons-material";
import { renderToString } from "react-dom/server";

import { VehiclePosition } from "@/types";

function vehicleIcon(routeColor: string, iconSize: number) {
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
        }}
      >
        <DirectionsBus
          style={{
            stroke: "black",
            fill: routeColor || "black",
            width: iconSize,
            height: iconSize,
          }}
        />
      </Box>
    ),
    className: "", // Important for a transparent background in Leaflet
  });
}

function LiveVehiclesRaw({ iconSize }: { iconSize: number }) {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const lastUpdatedRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const headers = new Headers();
      if (lastUpdatedRef.current) {
        // DigitalOcean's App Platform strips the "if-modified-since" header
        headers.append("x-if-modified-since", lastUpdatedRef.current);
      }

      const resp = await fetch("/api/vehicle-positions", { headers });
      if (resp.status === 304) {
        return; // No new data
      }

      const vehiclePositions = await resp.json();
      lastUpdatedRef.current = resp.headers.get("last-modified");
      setVehicles(vehiclePositions);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {vehicles.map(({ vehicleId, route: { routeColor }, position }) => (
        <Marker
          key={vehicleId}
          position={position}
          icon={vehicleIcon(routeColor, iconSize)}
          // This looks a bit weird but it is better for the buses to be behind the stops
          //   so stops don't get hidden. -5 isn't enough but -10 seems to work
          zIndexOffset={-10}
        />
      ))}
    </>
  );
}

export const LiveVehicles = memo(LiveVehiclesRaw);
