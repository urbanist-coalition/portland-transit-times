"use client";

import 'leaflet/dist/leaflet.css';

import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PlaceIcon from '@mui/icons-material/Place';
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { renderToString } from 'react-dom/server';
import { useStops } from '@/components/stops-provider';
import LinePill from './line-pill';

const myLocationDivIcon = L.divIcon({
  html: renderToString(<MyLocationIcon style={{ color: 'blue' }} />),
  className: "", // optional: add custom class for styling
  iconSize: [12, 12],
  iconAnchor: [12, 24],  // adjust if needed so that the "point" of the icon is at the correct spot
});

const placeDivIcon = L.divIcon({
  html: renderToString(<PlaceIcon style={{ color: 'red' }} />),
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

interface MapProps {
  location: {
    latitude: number;
    longitude: number;
  } | null;
  stopDistances?: number[];
}

const RecenterAutomatically = ({ location }: MapProps) => {
  const map = useMap();
  const [hadLocation, setHadLocation] = useState(false);
  useEffect(() => {
    if (!location || hadLocation) return;
    const { latitude: lat, longitude: lng } = location;
    map.setView([lat, lng], 16);
    setHadLocation(true);
  }, [location, hadLocation, map]);

  return null;
}

const CenterMeButton = ({ location }: MapProps) => {
  const map = useMap();

  if (!location) return null;

  function centerOnLocation() {
    if (!location) return;
    const { latitude: lat, longitude: lng } = location;
    map.setView([lat, lng], 16);
  }

  return (
    <Tooltip title="Center on your location">
      <IconButton sx={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10000, color: "black" }} onClick={centerOnLocation}>
        <MyLocationIcon />
      </IconButton>
    </Tooltip>
  );
}

export default function Map({ location, stopDistances }: MapProps) {
  const { stops } = useStops();
  const router = useRouter();

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    };
  }

  return (
    <MapContainer
      center={[43.6632339, -70.2864549]}
      zoom={13}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
      />
      {location && (<Marker position={[location.latitude, location.longitude]} icon={myLocationDivIcon}>
        <Popup>Your Location</Popup>
      </Marker>)}
      {/* Markers for closest stops */}
      {stops.map((stop, i) => (
        <Marker riseOnHover={true} key={stop.stopCode} position={[stop.location.lat, stop.location.lng]} icon={placeDivIcon}>
          <Popup>
            <Box style={{ textAlign: "center" }}>
              <Typography variant="h6">
                {stop.stopName}
              </Typography>
              <Typography variant="caption">
                Code: {stop.stopCode}
              </Typography><br />
              {stopDistances && stopDistances[i] && (
                <Typography variant="caption">
                  {Math.round(stopDistances[i])} meters away
                </Typography>
              )}
              {stop.lines && stop.lines.length > 0 && (
                <Stack direction="row" spacing={1} m={1} justifyContent="center">
                  {stop.lines.map(({ lineId, lineName, lineColor }) => (
                    <LinePill key={lineId} lineName={lineName} lineColor={lineColor} />
                  ))}
                </Stack>
              )}
              <Button variant="text" onClick={goToStop(stop.stopCode)}>View Stop</Button>
            </Box>
          </Popup>
        </Marker>
      ))}
      <RecenterAutomatically location={location} />
      <CenterMeButton location={location} />
    </MapContainer>
  );
}

