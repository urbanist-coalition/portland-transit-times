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

/**
 * Where a bus is against one of its calls.
 *
 * `departed` and `atStop` are claims about a vehicle and are only made when a
 * vehicle reported one — see TransitStore.vehicleStatus. The clock cannot make
 * them: at a stop where the bus waits, this agency's feed reports the arrival
 * it has already made and pushes the departure forward every poll, so a time
 * in the past means "it got here", not "it left".
 */
export enum StopTimeStatus {
  scheduled = "SCHEDULED",
  skipped = "SKIPPED",
  departed = "DEPARTED",
  /** The bus is standing at the stop now; nobody has missed it. */
  atStop = "AT_STOP",
}

/**
 * How far along its trip a bus has got, from the vehicle feed.
 *
 * This is the only source that answers "has it actually left?". The trip
 * updates cannot: a bus laying over at Maine Mall JC Penney from 5:02 with a
 * 5:15 departure is reported with an arrival of 5:02 and a departure of
 * whenever the feed was built, both of which are in the past for the thirteen
 * minutes it sits there with its doors open.
 */
export interface VehicleProgress {
  tripId: string;
  /** The stop it is standing at, or the one it is on its way to. */
  stopId: string;
  /**
   * That stop's place in the trip, where the agency gives one. GPMETRO sends
   * 0 for every vehicle, so the sequence is usually looked up from the
   * schedule instead.
   */
  sequence?: number;
  /** Standing at `stopId` rather than driving towards it. */
  stopped: boolean;
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
  /**
   * The bus finishes its run here — it arrives and nobody boards. Rendered as
   * an arrival rather than a departure, because offering it as one you can
   * catch is how someone ends up waiting for a bus going to the garage.
   */
  terminates?: boolean;
  /**
   * The timetable holds this call to the minute: the bus is not supposed to
   * leave before it, and waits if it is early. See ScheduledCall.timepoint.
   */
  timepoint?: true;

  // Denormalized Route Info
  route: Route;

  // Denormalized Trip Info
  trip: Trip;
}

/**
 * A departure with whatever the agency has since said about it — which, for
 * most departures most of the time, is nothing.
 *
 * The prediction fields are optional because their absence is the fact: 92% of
 * the rows on a stop page are calls no vehicle has reported, and a page that
 * fills them in with the scheduled time and calls the result "On Time" is
 * making a claim on the agency's behalf that the agency never made.
 */
export type LiveStopTimeInstance = StopTimeInstance & {
  predictedTime?: number;
  status?: StopTimeStatus;
  /** The agency said something about this exact call. */
  reported?: true;
};

/**
 * One call on a trip, as a trip page shows it: which stop, and when the bus is
 * now expected there.
 *
 * Flatter than a LiveStopTimeInstance because the whole page is one trip on one
 * route — naming them on every row would be thirty copies of the heading — and
 * because the row has a stop to identify rather than a bus.
 */
export interface TripCall {
  stopId: string;
  stopCode: string;
  stopName: string;
  /** Where in the trip this call falls; what the rows are ordered by. */
  sequence: number;
  /**
   * The timetable's own time of day, "HH:MM:SS". True of every day the trip
   * runs, which is why a trip page can be built once rather than once a day.
   */
  time: string;
  /** The bus holds here until this time rather than passing through it. */
  timepoint?: true;
  /**
   * What this call comes to on the day the bus is actually running it, and what
   * the agency now expects. Absent from the timetable a page is built with;
   * present once the trip is out on the road.
   */
  scheduledTime?: number;
  predictedTime?: number;
  status?: StopTimeStatus;
  /**
   * The agency said something about this exact call, rather than this being
   * what its delay at a neighbouring stop implies. Only a reported call earns
   * a status badge; an inferred one still moves the time, because a column of
   * times that runs backwards is wrong on its face.
   */
  reported?: true;
}
