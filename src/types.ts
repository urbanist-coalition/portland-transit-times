export interface Location {
  lat: number;
  lng: number;
  cap?: number;
}

export interface LineDataSlim {
  lineId: number;
  lineName: string;
  lineColor: string;
}

export interface LineData extends LineDataSlim {
  points: Location[][];
}

export interface StopData {
  stopId: number;
  stopName: string;
  stopCode: string;
  location: Location;
  lineIds: number[];
}

export interface VehicleData {
  vehicleId: number;
  lineName: string;
  location: Location;
}

// Very simplified from gtfs-realtime-bindings
export interface ServiceAlert {
  id: string;
  headerText: string;
  descriptionText: string;
}
