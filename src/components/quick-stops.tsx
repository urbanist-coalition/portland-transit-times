"use client";

import { allStops } from "@/constants";
import { StopData } from "@/types";
import { History, Star, StarOutline } from "@mui/icons-material";
import { Box, Chip, IconButton, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const MAX_QUICK_STOPS = 10;

interface StopCode {
  stopCode: string;
}

function toStopData(stopCodes: StopCode[]): StopData[] {
  return stopCodes
    .map(({ stopCode }) => allStops[stopCode])
    .filter((stop): stop is StopData => Boolean(stop));
}

function getRecentStopCodes(): StopCode[] {
  return JSON.parse(window.localStorage.getItem("recentStops") || "[]");
}

function addRecentStop(stopCode: string) {
  const recentStops = [
    { stopCode },
    ...getRecentStopCodes().filter((stop) => stop.stopCode !== stopCode),
  ];
  window.localStorage.setItem(
    "recentStops",
    JSON.stringify(recentStops.slice(0, MAX_QUICK_STOPS))
  );
}

function getSavedStopCodes(): StopCode[] {
  return JSON.parse(window.localStorage.getItem("savedStops") || "[]");
}

function addSavedStop(stopCode: string) {
  const savedStops = [
    { stopCode },
    ...getSavedStopCodes().filter((stop) => stop.stopCode !== stopCode),
  ];
  window.localStorage.setItem("savedStops", JSON.stringify(savedStops));
}

function removeSavedStop(stopCode: string) {
  const savedStops = getSavedStopCodes().filter(
    (stop) => stop.stopCode !== stopCode
  );
  window.localStorage.setItem("savedStops", JSON.stringify(savedStops));
}

export function AddRecentStop({ stopCode }: StopCode) {
  useEffect(() => {
    addRecentStop(stopCode);
  }, [stopCode]);
  return null;
}

export function SaveStop({ stopCode }: StopCode) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const savedStops = getSavedStopCodes();
    setSaved(savedStops.some((stop) => stop.stopCode === stopCode));
  });

  const save = () => {
    if (saved) {
      removeSavedStop(stopCode);
    } else {
      addSavedStop(stopCode);
    }
    setSaved(!saved);
  };

  return (
    <IconButton onClick={save}>{saved ? <Star /> : <StarOutline />}</IconButton>
  );
}

// Note: This component only works if AddRecentStop and SaveStop are never on the same page as this component
//   it doesn't re-render when the saved stops change
export function QuickStops() {
  const router = useRouter();
  const [savedStops, setSavedStops] = useState<StopData[]>([]);
  const [recentStops, setRecentStops] = useState<StopData[]>([]);

  const clippedRecentStops = recentStops
    // Filter out stops that are already saved
    .filter(
      ({ stopCode }) => !savedStops.some((stop) => stop.stopCode === stopCode)
    )
    // We only want up to MAX_QUICK_STOPS items in total so clip these
    .slice(0, MAX_QUICK_STOPS - savedStops.length);

  useEffect(() => {
    setSavedStops(toStopData(getSavedStopCodes()));
    setRecentStops(toStopData(getRecentStopCodes()));
  }, []);

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    };
  }

  return (
    <Box>
      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Quick Stops
        </Typography>
        <Stack
          direction="row"
          flexWrap="wrap"
          rowGap={2} // Vertical spacing
          columnGap={2} // Horizontal spacing
        >
          {savedStops.map(({ stopCode, stopName }) => (
            <Chip
              key={stopCode}
              label={`${stopCode}: ${stopName}`}
              onClick={goToStop(stopCode)}
              sx={{ cursor: "pointer" }}
              icon={<Star />}
            />
          ))}
          {clippedRecentStops.map(({ stopCode, stopName }) => (
            <Chip
              key={stopCode}
              label={`${stopCode}: ${stopName}`}
              onClick={goToStop(stopCode)}
              sx={{ cursor: "pointer" }}
              icon={<History />}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
