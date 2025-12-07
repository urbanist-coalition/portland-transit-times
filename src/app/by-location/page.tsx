import { getLines, getStops } from "@/lib/actions";
import ByLocation from "@/components/by-location";

export const dynamic = "force-dynamic";

export default async function ByLocationPage() {
  const allLines = await getLines();
  const allStops = await getStops();
  return <ByLocation allLines={allLines} allStops={allStops} />;
}
