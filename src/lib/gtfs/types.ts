export interface GTFSSystem {
  // TODO: read this from the agency.txt file
  timeZone: string;
  staticURL: string;
  vehicleURL: string;
  alertsURL: string;
  tripUpdatesURL: string;
}

export const GPMETRO: GTFSSystem = {
  timeZone: "America/New_York",
  staticURL: "https://gtfs.gptd.cadavl.com/GPTD/GTFS/GTFS_GPTD.zip",
  vehicleURL:
    "https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/VehiclePosition.pb",
  alertsURL:
    "https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/Alert.pb",
  tripUpdatesURL:
    "https://gtfsrt.gptd.cadavl.com/ProfilGtfsRt2_0RSProducer-GPTD/TripUpdate.pb",
};
