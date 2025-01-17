"use client";

import dynamic from "next/dynamic";

const DynamicRecentStops = dynamic(
  () =>
    import("@/components/recent-stops").then(({ RecentStops }) => RecentStops),
  {
    ssr: false,
  }
);

export default function RecentStops() {
  return <DynamicRecentStops />;
}
