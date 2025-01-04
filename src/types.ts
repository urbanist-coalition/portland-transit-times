export interface Location {
  lat: number;
  lng: number;
  cap?: number;
}

export interface LineData {
  lineId: number;
  lineName: string;
  lineColor: string;
  points: Location[][];
}

export interface StopData {
  stopId: number;
  stopName: string
  stopCode: string;
  location: Location;
  lineIds: number[];
}

