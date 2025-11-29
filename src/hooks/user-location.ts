import { distance } from "@/lib/utils";
import { Location } from "@/types";
import { useEffect, useRef, useState } from "react";

type LocationInfo =
  | {
      status: "fetching";
    }
  | {
      status: "loaded";
      location: Location;
    }
  | {
      status: "error";
      message: string;
    };

const MIN_MOVE = 15; // Ignore moves < 15 m (below GPS jitter on phones)

export default function useUserLocation() {
  const [locationInfo, setLocationInfo] = useState<LocationInfo>({
    status: "fetching",
  });
  const lastLocationInfoRef = useRef<LocationInfo>(locationInfo);

  useEffect(() => {
    const lastLocationInfo = lastLocationInfoRef.current;
    if (
      lastLocationInfo.status === "error" &&
      [
        "You denied the request for Geolocation. Please enable it to find stops by location.",
        "Geolocation is not available on this device.",
      ].includes(lastLocationInfo.message)
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
        if (lastLocationInfo.status === "loaded") {
          const moved = distance(
            lastLocationInfo.location.lat,
            lastLocationInfo.location.lng,
            position.coords.latitude,
            position.coords.longitude
          ); // metres
          const threshold = Math.max(MIN_MOVE, position.coords.accuracy);
          if (moved < threshold) {
            // Too small – ignore this jitter
            return;
          }
        }
        const locationInfo: LocationInfo = {
          status: "loaded",
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        };

        lastLocationInfoRef.current = locationInfo;
        setLocationInfo(locationInfo);
      },
      (geoError) => {
        const { PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT } =
          GeolocationPositionError;
        const errorMessages: Record<number, string> = {
          [PERMISSION_DENIED]:
            "You denied the request for Geolocation. Please enable it to find stops by location.",
          [POSITION_UNAVAILABLE]: "Location information is unavailable.",
          [TIMEOUT]: "Location request timed out. Please try again.",
        };
        setLocationInfo({
          status: "error",
          message:
            errorMessages[geoError.code] ||
            "An unknown error occurred while fetching your location.",
        });
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return locationInfo;
}
