"use client";

import { Box } from "@mui/material";
import dynamic from "next/dynamic";
import { Stop, RouteWithShape } from "@/types";
import { getLines, getStops } from "@/lib/actions";
import { useEffect, useState } from "react";

const DynamicMap = dynamic(() => import("@/components/map"), { ssr: false });

export default function ByLocation() {
  const [allLines, setAllLines] = useState<RouteWithShape[]>([]);
  const [allStops, setAllStops] = useState<Record<string, Stop>>({});

  useEffect(() => {
    getLines().then(setAllLines);
    getStops().then(setAllStops);
  }, []);

  return (
    <Box style={{ height: "100dvh", width: "100vw" }}>
      <DynamicMap allLines={allLines} allStops={allStops} />
    </Box>
  );
}
