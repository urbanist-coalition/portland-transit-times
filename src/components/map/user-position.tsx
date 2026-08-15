"use client";

import { Marker, useMap } from "react-leaflet";
import { memo, useEffect, useRef } from "react";
import L from "leaflet";

import { LocationSearchingIcon, MyLocationIcon } from "@/components/icons";
import { Location } from "@/types";
import { distance } from "@/lib/utils";
import useUserLocation from "@/hooks/user-location";

import styles from "./map.module.css";

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

  const centered =
    distance(location.lat, location.lng, center.lat, center.lng) < 5;

  return (
    <button
      type="button"
      className={styles.centerButton}
      onClick={centerOnLocation}
      aria-label="Center on your location"
      title="Center on your location"
    >
      {centered ? <MyLocationIcon /> : <LocationSearchingIcon />}
    </button>
  );
};

function UserPositionRaw({ center }: { center: Location }) {
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

export const UserPosition = memo(UserPositionRaw);
