"use client";

import { StopData } from "@/types";
import { Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import NearMeIcon from "@mui/icons-material/NearMe";
import { useStops } from '@/components/stops-provider';
import { distance } from '@/lib/utils';
import dynamic from 'next/dynamic';

type LocationInfo = {
  status: "fetching";
} | {
  status: "loaded";
  location: { latitude: number; longitude: number };
  stopDistances: number[];
  closestStops: [StopData, number][];
} | {
  status: "error";
  message: string;
};

const DynamicMap = dynamic(() => import('@/components/map'), { ssr: false });

function NearbyStopsBox({ locationInfo }: { locationInfo: LocationInfo }) {
  const router = useRouter();

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    };
  }

  if (locationInfo.status === "fetching") {
    return <Typography variant="body1">Waiting for your location...</Typography>;
  }

  if (locationInfo.status === "error") {
    return (
      <Box>
        <Typography variant="body1" color="error">{locationInfo.message}</Typography>
      </Box>
    );
  }

  const { closestStops } = locationInfo;

  return (
    <Box>
      <Typography variant="h6">
        Nearby Stops:
      </Typography>

      <Box mt={4}>
        <Stack direction="row" flexWrap="wrap" rowGap={2} columnGap={2}>
          {closestStops.map(([{ stopCode, stopName }, meters]) => (
            <Chip
              key={stopCode}
              icon={<NearMeIcon />}
              label={`(${Math.round(meters)} m) ${stopCode}: ${stopName}`}
              onClick={goToStop(stopCode)}
              sx={{ cursor: "pointer" }}
              color="primary"
              variant="outlined"
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

export default function ByLocation() {
  const { stops } = useStops();
  const [locationInfo, setLocationInfo] = useState<LocationInfo>({ status: "fetching" });

  useEffect(() => {
    function fetchLocation() {
      if (!("geolocation" in navigator)) {
        setLocationInfo({ status: "error", message: "Geolocation is not available on this device." });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const stopDistances = stops.map(stop => distance(
            stop.location.lat,
            stop.location.lng,
            position.coords.latitude,
            position.coords.longitude,
          ));
          setLocationInfo({
            status: "loaded",
            location: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
            stopDistances,
            closestStops: stops.map((stop, idx) => [stop, stopDistances[idx]] as [StopData, number]).toSorted((a, b) => a[1] - b[1]).slice(0, 5),
          });

        },
        (geoError) => {
          if (geoError.code === geoError.PERMISSION_DENIED) {
            setLocationInfo({ status: "error", message: "You denied the request for Geolocation. Please enable it to find stops by location." });
            return;
          }
          if (geoError.code === geoError.POSITION_UNAVAILABLE) {
            setLocationInfo({ status: "error", message: "Location information is unavailable." });
            return;
          }
          if (geoError.code === geoError.TIMEOUT) {
            setLocationInfo({ status: "error", message: "Location request timed out. Please try again." });
            return;
          }
          setLocationInfo({ status: "error", message: "An unknown error occurred while fetching your location." });
        }
      );
    }

    fetchLocation();
    const interval = setInterval(fetchLocation, 10000);
    return () => clearTimeout(interval);
  }, [stops]);

  const location = locationInfo.status === "loaded" ? locationInfo.location : null;
  const stopDistances = locationInfo.status === "loaded" ? locationInfo.stopDistances : undefined;
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Find Stops By Location
      </Typography>

      <Box mt={4} mb={4} style={{ height: "400px", width: "100%" }}>
        <DynamicMap location={location} stopDistances={stopDistances} />
      </Box>

      <NearbyStopsBox locationInfo={locationInfo} />

      <Box textAlign="center" mt={2}>
        <Typography variant="caption" display="block" gutterBottom>
          Don{"'"}t see your stop? You can search for your stop by number or name on the home page.
        </Typography>
        <Link href="/" passHref>
          <Button variant="outlined">Home</Button>
        </Link>
      </Box>
    </Container>
  );
}

