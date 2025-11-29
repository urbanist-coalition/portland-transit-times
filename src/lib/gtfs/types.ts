export interface GTFSSystem {
  // TODO: read this from the agency.txt file
  timeZone: string;
  staticURL: string;
  vehicleURL: string;
  alertsURL: string;
  tripUpdatesURL: string;
  authorization?: string;
}
