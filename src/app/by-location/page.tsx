import { getLines, getStops } from "@/lib/actions";
import ByLocation from "@/components/by-location";

// Static page, revalidated by worker via /api/revalidate when GTFS data changes
export const revalidate = false;

export default async function ByLocationPage() {
  const allLines = await getLines();
  const allStops = await getStops();
  return <ByLocation allLines={allLines} allStops={allStops} />;
}
