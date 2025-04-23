"use client";

import { Box } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { distance } from "@/lib/utils";
import dynamic from "next/dynamic";
import { Stop, RouteWithShape, Location } from "@/lib/model";

type LocationInfo =
  | {
      status: "fetching";
      message?: undefined;
    }
  | {
      status: "loaded";
      location: { lat: number; lng: number };
      stopDistances: number[];
      closestStops: [Stop, number][];
      message?: undefined;
    }
  | {
      status: "error";
      message: string;
    };

const DynamicMap = dynamic(() => import("@/components/map"), { ssr: false });

interface ByLocationProps {
  allLines: Record<string, RouteWithShape>;
  allStops: Record<string, Stop>;
}

const MIN_MOVE = 15; // Ignore moves < 15 m (below GPS jitter on phones)

export default function ByLocation({ allLines, allStops }: ByLocationProps) {
  const [locationInfo, setLocationInfo] = useState<LocationInfo>({
    status: "fetching",
  });
  const lastPositionRef = useRef<Location | null>(null);

  useEffect(() => {
    const stopsArray = Object.values(allStops);
    if (stopsArray.length === 0) return;

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

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        // To cut down on rendering from jitter, only update if it moves by enough
        const prev = lastPositionRef.current;
        if (prev) {
          const moved = distance(
            prev.lat,
            prev.lng,
            position.coords.latitude,
            position.coords.longitude
          ); // metres
          const threshold = Math.max(MIN_MOVE, position.coords.accuracy);
          if (moved < threshold) {
            // Too small – ignore this jitter
            return;
          }
        }
        lastPositionRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

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
            .map((stop, idx) => [stop, stopDistances[idx]] as [Stop, number])
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

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [allStops, locationInfo.status, locationInfo.message]);

  const location =
    locationInfo.status === "loaded" ? locationInfo.location : null;
  const stopDistances =
    locationInfo.status === "loaded" ? locationInfo.stopDistances : undefined;
  return (
    <Box style={{ height: "100dvh", width: "100vw" }}>
      <DynamicMap
        location={location}
        stopDistances={stopDistances}
        allLines={allLines}
        allStops={allStops}
      />
    </Box>
  );
}
