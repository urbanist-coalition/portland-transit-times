import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  // DigitalOcean's App Platform strips the "if-modified-since" header
  // Check if the request has an "x-if-modified-since" header
  const ifModifiedSince = req.headers.get("if-modified-since");
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);

  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-length": response?.length.toString() || "0",
      "content-type": "application/json",
      // "cache-control": "public, max-age=0, s-max-age=1, must-revalidate",
      // "cache-control": "public, must-revalidate",
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
