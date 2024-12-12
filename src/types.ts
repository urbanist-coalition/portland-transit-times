import { Location as ConduentLocation } from "@/lib/conduent"

export type Location = ConduentLocation;

export interface LineData {
  stopId: number;
  lineName: string;
  lineColor: string;
}

export interface StopData {
  stopId: number;
  stopName: string
  stopCode: string;
  location: Location;
  lines: LineData[];
}

export interface MinimalStop {
  stopCode: string;
  stopName: string;
  location: Location;
}
