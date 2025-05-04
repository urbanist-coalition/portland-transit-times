import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  // DigitalOcean's App Platform strips the "if-modified-since" header
  // Check if the request has an "x-if-modified-since" header
  const ifModifiedSince = req.headers.get("x-if-modified-since");
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);

  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
