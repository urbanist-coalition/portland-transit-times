"use client";

import "leaflet/dist/leaflet.css";

import { useState } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";

import { useColorMode } from "@/components/color-mode";
import { Stop, Location, RouteWithShape } from "@/types";

import { LiveVehicles } from "./live-vehicles";
import { Routes } from "./routes";
import { VisibleStops } from "./visible-stops";
import { UserPosition } from "./user-position";
import styles from "./map.module.css";

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

  const { resolved } = useColorMode();
  const baseMap = resolved === "dark" ? "dark_all" : "rastertiles/voyager";
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
      <div className={styles.attribution}>
        &copy;{" "}
        <a
          className={styles.attributionLink}
          href="https://www.openstreetmap.org/copyright"
        >
          OpenStreetMap
        </a>{" "}
        contributors | Map tiles by{" "}
        <a className={styles.attributionLink} href="https://carto.com/">
          Carto
        </a>
      </div>
    </MapContainer>
  );
}
