import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  // Check if the request has an "if-modified-since" header
  const ifModifiedSince = req.headers.get("x-if-modified-since");
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);
  console.log(req.headers); // headers without any if-modified-since
  console.log("dates", currentUpdatedAt?.toUTCString(), clientDate); // dates Sun, 04 May 2025 16:52:37 GMT null

  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=0, must-revalidate",
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
