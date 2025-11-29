import { getModel } from "@/lib/model";

// Because this route has no dynamic parameters, apparently Next.js caches it by default.
// We don't want Next.js to cache this route, so we force it to be dynamic.
// We handle caching ourselves using Last-Modified headers.
export const dynamic = "force-dynamic";

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
