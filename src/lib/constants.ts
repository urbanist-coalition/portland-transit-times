import { GTFSSystem } from "@/lib/gtfs/types";

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
