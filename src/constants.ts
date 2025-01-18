import stops from "@/_data/all-stops.json";
import lines from "@/_data/all-lines.json";
import { LineData, StopData } from "@/types";

export const allStops: Record<string, StopData> = stops;
export const allLines: Record<string, LineData> = lines;
