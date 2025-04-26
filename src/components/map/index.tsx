"use client";

import "leaflet/dist/leaflet.css";

import { Paper, Typography, useTheme } from "@mui/material";
import { useState } from "react";
import MaterialLink from "@mui/material/Link";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { Stop, Location, RouteWithShape } from "@/types";

import { LiveVehicles } from "./live-vehicles";
import { Routes } from "./routes";
import { VisibleStops } from "./visible-stops";
import { UserPosition } from "./user-position";

function PositionSync({
  setZoom,
  setCenter,
}: {
  setZoom: (zoom: number) => void;
  setCenter: (center: Location) => void;
}) {
  useMapEvents({
    zoomend: ({ target }) => setZoom(target.getZoom()),
    moveend: ({ target }) => setCenter(target.getCenter()),
  });

  return null;
}

interface MapProps {
  allLines: RouteWithShape[];
  allStops: Record<string, Stop>;
}

export default function TransitMap({ allLines, allStops }: MapProps) {
  const [zoom, setZoom] = useState(13);
  const [center, setCenter] = useState({ lat: 43.6632339, lng: -70.2864549 });

  const zoomIconSizes: Record<number, number> = {
    13: 10,
    14: 12,
    15: 14,
    16: 16,
    17: 18,
    18: 20,
    19: 22,
    20: 24,
  };

  const iconSize = zoomIconSizes[zoom] || 10;

  const theme = useTheme();
  const baseMap =
    theme.palette.mode === "dark" ? "dark_all" : "rastertiles/voyager";
  const baseMapUrl = `https://{s}.basemaps.cartocdn.com/${baseMap}/{z}/{x}/{y}.png`;

  return (
    <MapContainer
      // Speed up rendering by using canvas instead of SVG
      preferCanvas
      center={[43.6632339, -70.2864549]}
      zoom={13}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url={baseMapUrl} />
      <LiveVehicles iconSize={iconSize} />
      <UserPosition center={center} />
      <VisibleStops
        allStops={allStops}
        zoom={zoom}
        iconSize={iconSize}
        center={center}
      />
      <Routes routes={allLines} />
      <PositionSync setZoom={setZoom} setCenter={setCenter} />
      {/* Custom Attribution */}
      <Paper
        elevation={3}
        sx={{
          position: "absolute",
          bottom: 8,
          left: 8,
          padding: "6px 12px",
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          zIndex: 400,
        }}
      >
        <Typography variant="body2" component="div" fontSize={10}>
          &copy;{" "}
          <MaterialLink
            href="https://www.openstreetmap.org/copyright"
            color="inherit"
            underline="hover"
          >
            OpenStreetMap
          </MaterialLink>{" "}
          contributors | Map tiles by{" "}
          <MaterialLink
            href="https://carto.com/"
            color="inherit"
            underline="hover"
          >
            Carto
          </MaterialLink>
        </Typography>
      </Paper>
    </MapContainer>
  );
}
