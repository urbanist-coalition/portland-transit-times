import { getModel } from "@/lib/model";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  console.log("Current Updated At:", currentUpdatedAt);
  const ifModifiedSince = req.headers.get("if-modified-since");
  console.log("If-Modified-Since:", ifModifiedSince);
  const clientDate = ifModifiedSince && new Date(ifModifiedSince);
  console.log("Client Date:", clientDate);

  console.log(
    "Cached",
    currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate
  );
  // If the server's last update is not newer than the client's date, return 304
  if (currentUpdatedAt && clientDate && currentUpdatedAt <= clientDate) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-length": response?.length.toString() || "0",
      "content-type": "application/json",
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
