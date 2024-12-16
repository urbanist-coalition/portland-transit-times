"use client";

import { getClosestStops } from "@/lib/actions";
import { MinimalStop } from "@/types";
import { Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import NearMeIcon from "@mui/icons-material/NearMe";

export default function ByLocation() {
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [closestStops, setClosestStops] = useState<[MinimalStop, number][]>([]);

  const router = useRouter();

  // Attempt to get user's current position
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError("You denied the request for Geolocation. Please enable it to find stops by location.");
          return;
        }
        if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setError("Location information is unavailable.");
          return;
        }
        if (geoError.code === geoError.TIMEOUT) {
          setError("Location request timed out. Please try again.");
          return;
        }
        setError("An unknown error occurred.");
      }
    );
  }, []);

  // Fetch closest stops once we have location
  useEffect(() => {
    if (!location) return;
    getClosestStops(location.latitude, location.longitude)
      .then(setClosestStops)
      .catch((err) => {
        console.error("Error fetching closest stops:", err);
        setClosestStops([]);
      });
  }, [location]);

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    };
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 4, textAlign: "center" }}>
        <Typography variant="h4" gutterBottom>
          We&apos;re Sorry
        </Typography>
        <Typography variant="body1" gutterBottom>
          {error}
        </Typography>
        <Typography variant="body2" gutterBottom>
          Please try a different way to find stops.
        </Typography>
        <Link href="/" passHref>
          <Button variant="contained" sx={{ mt: 2 }}>
            Go Back
          </Button>
        </Link>
      </Container>
    );
  }

  if (!location) {
    return (
      <Container maxWidth="sm" sx={{ py: 4, textAlign: "center" }}>
        <Typography variant="h4" gutterBottom>
          Finding Your Location
        </Typography>
        <Typography variant="body1">
          One moment please...
        </Typography>
        <Box textAlign="center" mt={2}>
          <Link href="/" passHref>
            <Button variant="outlined">Go Back</Button>
          </Link>
        </Box>
      </Container>
    );
  }

  // If we have a location and no error
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Stops Near You
      </Typography>
      <Typography variant="body1" gutterBottom>
        We have found some stops near your current location.
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
      <Box textAlign="center" mt={2}>
        <Typography variant="caption" display="block" gutterBottom>
          Don't see your stop? You can search for your stop by number or name on the home page.
        </Typography>
        <Link href="/" passHref>
          <Button variant="outlined">Home</Button>
        </Link>
      </Box>
    </Container>
  );
}

