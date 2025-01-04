"use client";

import { StopData } from "@/types";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStaticData } from "@/components/static-data-provider";

interface StopCode {
  stopCode: string;
}

function getRecentStopCodes(): StopCode[] {
  return JSON.parse(window.localStorage.getItem("recentStops") || "[]");
}

function getRecentStops(stops: Record<string, StopData>): StopData[] {
  return getRecentStopCodes()
    .map(({ stopCode }) => stops[stopCode])
    .filter((stop): stop is StopData => Boolean(stop));
}

function addRecentStop(stopCode: string) {
  const recentStops = [{ stopCode }, ...getRecentStopCodes().filter((stop) => stop.stopCode !== stopCode)];
  window.localStorage.setItem("recentStops", JSON.stringify(recentStops.slice(0, 10)));
}

export function AddRecentStop({ stopCode, stopName }: { stopCode: string, stopName: string }) {
  useEffect(() => {
    addRecentStop(stopCode);
  }, [stopCode, stopName]);
  return null;
}

export function RecentStops() {
  const router = useRouter();
  const { stops } = useStaticData();
  const [recentStops, setRecentStops] = useState<StopData[]>([]);
  useEffect(() => {
    setRecentStops(getRecentStops(stops));
  }, [stops]);

  function goToStop(stopCode: string) {
    return () => {
      router.push(`/stops/${stopCode}`);
    }
  }

  return (<Box>
    <Box mt={4}>
      <Typography variant="h6" gutterBottom>
        Recent Stops
      </Typography>
      <Stack
        direction="row"
        flexWrap="wrap"
        rowGap={2} // Vertical spacing
        columnGap={2} // Horizontal spacing
      >
        {recentStops.map(({ stopCode, stopName }) => (
          <Chip
            key={stopCode}
            label={`${stopCode}: ${stopName}`}
            onClick={goToStop(stopCode)}
            sx={{ cursor: "pointer" }}
          />
        ))}
      </Stack>
    </Box>
  </Box>);
}
