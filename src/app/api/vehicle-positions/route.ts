import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  // Check if the request has an "If-Modified-Since" header
  const ifModifiedSince = req.headers.get("If-Modified-Since");
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);
  console.log("dates", currentUpdatedAt, clientDate);

  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-transform",
      "Last-Modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
