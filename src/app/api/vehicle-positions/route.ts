import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  // Check if the request has an "if-modified-since" header
  const ifModifiedSince = req.headers.get("if-modified-since");
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);
  console.log(req.headers);
  console.log("dates", currentUpdatedAt, clientDate);

  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache, no-transform",
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
