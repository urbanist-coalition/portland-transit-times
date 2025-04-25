export interface Location {
  lat: number;
  lng: number;
}

// Static Data

export interface Route {
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
}

export interface RouteWithShape extends Route {
  // Denormalized Shape Info
  shapes: Location[][];
}

export interface Trip {
  tripId: string;
  routeId: string;
  serviceId: string;
  shapeId: string;

  tripHeadsign: string;
}

export interface Stop {
  stopId: string;
  stopCode: string;
  stopName: string;
  location: Location;

  // Denormalized Route Info
  routes: Route[];
}

// Real-time Data

export interface Alert {
  id: string; // Corresponds to the feed entity ID
  headerText: string;
  descriptionText: string;
}

export interface VehiclePosition {
  vehicleId: string;
  position: Location;

  // Denormalized Route Info
  route: Route;
}

export interface VehiclePositions {
  vehicles: VehiclePosition[];
  updatedAt: number;
}

export enum StopTimeStatus {
  scheduled = "SCHEDULED",
  skipped = "SKIPPED",
  departed = "DEPARTED",
}

export interface StopTimeInstanceBase {
  serviceDate: string;
  tripId: string;
  stopId: string;
}

export interface StopTimeUpdate extends StopTimeInstanceBase {
  predictedTime: number; // Unix timestamp in seconds
  status: StopTimeStatus;
}

export interface StopTimeInstance extends StopTimeInstanceBase {
  scheduledTime: number; // Unix timestamp in seconds

  // Denormalized Route Info
  route: Route;

  // Denormalized Trip Info
  trip: Trip;
}

export type LiveStopTimeInstance = StopTimeInstance & StopTimeUpdate;
