import GtfsRealtimeBindings from "gtfs-realtime-bindings";
async function main() {
  console.log(process.env.SOUTH_PORTLAND_KEY);
  const response = await fetch(
    "https://api.goswift.ly/real-time/south-portland-transit/gtfs-rt-alerts/v2",
    {
      headers: {
        Authorization: process.env.SOUTH_PORTLAND_KEY!,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  console.log(feed);
}
main();
