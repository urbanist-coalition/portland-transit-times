import { JSONSchemaType } from "ajv";

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
  vehicleId: string;
  lineName: string;
  location: Location;
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
