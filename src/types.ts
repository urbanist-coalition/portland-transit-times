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

/**
 * The subset of a stop needed to search for it and link to it. Sending these
 * instead of full stops keeps the home page payload small — there are ~500
 * stops and their route and location data is nearly two thirds of the bytes.
 */
export interface StopSummary {
  stopCode: string;
  stopName: string;
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
  // Degrees clockwise from true north (0 = N, 90 = E). Optional in GTFS-RT.
  bearing?: number;

  // Denormalized Route Info
  route: Route;
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
