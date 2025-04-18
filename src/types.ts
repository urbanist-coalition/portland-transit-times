import { JSONSchemaType } from "ajv";

export interface Location {
  lat: number;
  lng: number;
  cap?: number;
}

export interface LineDataSlim {
  lineId: string;
  lineName: string;
  lineColor: string;
}

export interface LineData extends LineDataSlim {
  points: Location[][];
}

export interface StopData {
  stopId: string;
  stopName: string;
  stopCode: string;
  location: Location;
  lineIds: string[];
}

export interface VehicleData {
  vehicleId: string;
  lineName: string;
  location: Location;
}

export interface StopTimeData {
  serviceDate: string;
  serviceId: string;
  tripId: string;
  stopId: string;
  routeId: string;
  headsign: string;
  lineColor: string;
  lineName: string;
  scheduledTime: number;
  predictedTime: number;
}

export const vehicleDataSchema: JSONSchemaType<VehicleData> = {
  type: "object",
  properties: {
    vehicleId: { type: "string" },
    lineName: { type: "string" },
    location: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        cap: { type: "number", nullable: true },
      },
      required: ["lat", "lng"],
    },
  },
  required: ["vehicleId", "lineName", "location"],
};

// Very simplified from gtfs-realtime-bindings
export interface ServiceAlert {
  id: string;
  headerText: string;
  descriptionText: string;
}
