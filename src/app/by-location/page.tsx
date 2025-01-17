"use client";

import { StopData } from "@/types";
import { Box } from "@mui/material";
import { useEffect, useState } from "react";
import { useStaticData } from "@/components/static-data-provider";
import { distance } from "@/lib/utils";
import dynamic from "next/dynamic";

type LocationInfo =
  | {
      status: "fetching";
      message?: undefined;
    }
  | {
      status: "loaded";
      location: { lat: number; lng: number };
      stopDistances: number[];
      closestStops: [StopData, number][];
      message?: undefined;
    }
  | {
      status: "error";
      message: string;
    };

const DynamicMap = dynamic(() => import("@/components/map"), { ssr: false });

export default function ByLocation() {
  const { stops } = useStaticData();
  const [locationInfo, setLocationInfo] = useState<LocationInfo>({
    status: "fetching",
  });

  useEffect(() => {
    const stopsArray = Object.values(stops);
    function fetchLocation() {
      if (
        locationInfo.status === "error" &&
        [
          "You denied the request for Geolocation. Please enable it to find stops by location.",
          "Geolocation is not available on this device.",
        ].includes(locationInfo.message)
      ) {
        return;
      }

      if (!("geolocation" in navigator)) {
        setLocationInfo({
          status: "error",
          message: "Geolocation is not available on this device.",
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const stopDistances = stopsArray.map((stop) =>
            distance(
              stop.location.lat,
              stop.location.lng,
              position.coords.latitude,
              position.coords.longitude
            )
          );
          setLocationInfo({
            status: "loaded",
            location: {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            },
            stopDistances,
            closestStops: stopsArray
              .map(
                (stop, idx) => [stop, stopDistances[idx]] as [StopData, number]
              )
              .toSorted((a, b) => a[1] - b[1])
              .slice(0, 5),
          });
        },
        (geoError) => {
          if (geoError.code === geoError.PERMISSION_DENIED) {
            setLocationInfo({
              status: "error",
              message:
                "You denied the request for Geolocation. Please enable it to find stops by location.",
            });
            return;
          }
          if (geoError.code === geoError.POSITION_UNAVAILABLE) {
            setLocationInfo({
              status: "error",
              message: "Location information is unavailable.",
            });
            return;
          }
          if (geoError.code === geoError.TIMEOUT) {
            setLocationInfo({
              status: "error",
              message: "Location request timed out. Please try again.",
            });
            return;
          }
          setLocationInfo({
            status: "error",
            message: "An unknown error occurred while fetching your location.",
          });
        }
      );
    }

    fetchLocation();
    const interval = setInterval(fetchLocation, 10000);
    return () => clearTimeout(interval);
  }, [stops, locationInfo.status, locationInfo.message]);

  const location =
    locationInfo.status === "loaded" ? locationInfo.location : null;
  const stopDistances =
    locationInfo.status === "loaded" ? locationInfo.stopDistances : undefined;
  return (
    <Box style={{ height: "100dvh", width: "100vw" }}>
      <DynamicMap location={location} stopDistances={stopDistances} />
    </Box>
  );
}
