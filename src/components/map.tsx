"use client";

import 'leaflet/dist/leaflet.css';

import { Box, Button, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PlaceIcon from '@mui/icons-material/Place';
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { renderToString } from 'react-dom/server';
import { useStops } from '@/components/stops-provider';
import LinePill from './line-pill';
import Link from 'next/link';

interface MapProps {
  location: {
    lat: number;
    lng: number;
  } | null;
  stopDistances?: number[];
}

const RecenterAutomatically = ({ location }: MapProps) => {
  const map = useMap();
  const [hadLocation, setHadLocation] = useState(false);
  useEffect(() => {
    // only center on location when we first get a location
    if (!location || hadLocation) return;
    map.setView(location, 16);
    setHadLocation(true);
  }, [location, hadLocation, map]);

  return null;
}

const CenterMeButton = ({ location }: MapProps) => {
  const map = useMap();

  if (!location) return null;

  function centerOnLocation() {
    if (!location) return;
    map.setView(location, 16);
  }

  return (
    <Tooltip title="Center on your location">
      <IconButton
        sx={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          // 400 is exactly the minimum needed to be above the map, found with manual binary search
          zIndex: 400
        }}
        onClick={centerOnLocation}
      >
        <MyLocationIcon />
      </IconButton>
    </Tooltip>
  );
}

export default function Map({ location, stopDistances }: MapProps) {
  const { stops } = useStops();

  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const baseMap = prefersDarkMode ? 'dark_all' : 'rastertiles/voyager';
  const baseMapUrl = `https://{s}.basemaps.cartocdn.com/${baseMap}/{z}/{x}/{y}.png`;

  const theme = useTheme()

  const myLocationStyle = prefersDarkMode ? { fill: theme.palette.primary.dark } : {};
  const myLocationDivIcon = L.divIcon({
    html: renderToString(<MyLocationIcon style={myLocationStyle} />),
    className: "", // this must be blank or the icons will be in white boxes
    iconSize: [18, 18],
  });

  const placeStyle = prefersDarkMode ? { stroke: theme.palette.primary.dark } : { fill: theme.palette.primary.main };
  const placeDivIcon = L.divIcon({
    html: renderToString(<PlaceIcon style={placeStyle} />),
    className: "", // this must be blank or the icons will be in white boxes
    iconSize: [24, 24],
    iconAnchor: [12, 24], // centers bottom of pin on location
  });

  return (
    <MapContainer
      center={[43.6632339, -70.2864549]}
      zoom={13}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
      zoomControl={false}
    >
      <TileLayer url={baseMapUrl} />
      {location && (<Marker position={location} icon={myLocationDivIcon}>
        <Popup>Your Location</Popup>
      </Marker>)}
      {stops.map((stop, i) => (
        <Marker riseOnHover={true} key={stop.stopCode} position={stop.location} icon={placeDivIcon}>
          <Popup>
            <Box style={{ textAlign: "center" }}>
              <Typography variant="h6" color="textPrimary">
                {stop.stopName}
              </Typography>
              <Typography variant="caption" color="textPrimary">
                Code: {stop.stopCode}
              </Typography><br />
              {stopDistances && stopDistances[i] && (
                <Typography variant="caption" color="textPrimary">
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
              <Link href={`/stops/${stop.stopCode}`} passHref>
                <Button variant="text">View Arrivals</Button>
              </Link>
            </Box>
          </Popup>
        </Marker>
      ))}
      <RecenterAutomatically location={location} />
      <CenterMeButton location={location} />
    </MapContainer>
  );
}

