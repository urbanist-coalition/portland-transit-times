import { getModel } from "@/lib/model";
import { dumbIfModifiedSince } from "@/lib/utils";

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  const ifModifiedSince = dumbIfModifiedSince(req);
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
      "last-modified": currentUpdatedAt?.toUTCString() || "",
    },
  });
}
