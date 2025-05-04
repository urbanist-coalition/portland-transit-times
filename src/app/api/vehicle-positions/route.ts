import crypto from "crypto";

import { getModel } from "@/lib/model";

function md5(str: string | null | undefined) {
  if (!str) return null;
  return crypto.createHash("md5").update(str).digest("hex");
}

export async function GET(req: Request) {
  const currentUpdatedAt = await getModel().getVehiclePositionsUpdatedAt();
  const currentTag = md5(currentUpdatedAt?.toString());

  const etag = req.headers.get("if-none-match");
  console.log(req.headers);

  // If the etag matches the current tag, return 304 Not Modified
  if (currentTag && etag && currentTag === etag) {
    return new Response(null, { status: 304 });
  }

  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
      etag: currentTag || "",
    },
  });
}
