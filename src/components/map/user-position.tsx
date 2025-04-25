"use client";

import LocationSearchingIcon from "@mui/icons-material/LocationSearching";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { Marker, useMap } from "react-leaflet";
import { IconButton, Tooltip } from "@mui/material";
import { useEffect, useRef } from "react";
import L from "leaflet";

import { Location } from "@/types";
import { locationEquals } from "@/lib/utils";
import useUserLocation from "@/hooks/user-location";

const userLocationIcon = L.divIcon({
  className: "user-location-icon", // Add a class for potential styling
  html: '<div style="background-color: #007bff; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);"></div>',
  iconSize: [16, 16], // Size of the icon
  iconAnchor: [8, 8], // Point of the icon which will correspond to marker's location
});

const CenterMeButton = ({
  location,
  center,
}: {
  location: Location | null;
  center: Location;
}) => {
  const map = useMap();

  if (!location) return null;

  function centerOnLocation() {
    if (!location) return;
    map.setView(location, 16);
  }

  return (
    <Tooltip title="Center on your location" placement="bottom-start">
      <IconButton
        sx={{
          position: "absolute",
          top: 10,
          right: 10,
          // 400 is exactly the minimum needed to be above the map, found with manual binary search
          zIndex: 400,
        }}
        onClick={centerOnLocation}
      >
        {locationEquals(location, center) ? (
          <MyLocationIcon />
        ) : (
          <LocationSearchingIcon />
        )}
      </IconButton>
    </Tooltip>
  );
};

export function UserPosition({ center }: { center: Location }) {
  const map = useMap();

  const locationInfo = useUserLocation();
  const location =
    locationInfo.status === "loaded" ? locationInfo.location : null;
  const prevLocationInfo = useRef(locationInfo);

  // When we get a location for the first time, center the map on it
  useEffect(() => {
    if (
      locationInfo.status === "loaded" &&
      prevLocationInfo.current.status !== "loaded"
    ) {
      map.setView(locationInfo.location, 16);
    }
    prevLocationInfo.current = locationInfo;
  }, [locationInfo, map]);

  return (
    <>
      {location && <Marker position={location} icon={userLocationIcon} />}
      <CenterMeButton location={location} center={center} />
    </>
  );
}
