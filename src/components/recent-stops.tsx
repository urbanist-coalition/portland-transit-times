"use client";

import { MinimalStop } from "@/types";
import { toProperCase } from "@/lib/utils";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function getRecentStops(): MinimalStop[] {
  return JSON.parse(window.localStorage.getItem("recentStops") || "[]");
}

function addRecentStop(stopCode: string, stopName: string) {
  const recentStops = [{ stopCode, stopName }, ...getRecentStops().filter((stop) => stop.stopCode !== stopCode)];
  window.localStorage.setItem("recentStops", JSON.stringify(recentStops));
}

export function AddRecentStop({ stopCode, stopName }: { stopCode: string, stopName: string }) {
  useEffect(() => {
    addRecentStop(stopCode, toProperCase(stopName));
  }, [stopCode, stopName]);
  return <div />
}

export function RecentStops() {
  const router = useRouter();
  const [recentStops, setRecentStops] = useState<MinimalStop[]>([]);
  useEffect(() => {
    setRecentStops(getRecentStops());
  }, []);

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
