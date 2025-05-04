import { getModel } from "@/lib/model";
import { stopCodeToStopId } from "@/lib/utils";
import { subMinutes } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stopCode: string }> }
) {
  const { stopCode } = await params;
  if (!stopCode) {
    return new Response("stopCode is required", { status: 400 });
  }

  const stopId = stopCodeToStopId(stopCode.toString());

  const lastModified = await getModel().getStopUpdatedAt(stopId);

  const ifModifiedSince = req.headers.get("if-modified-since");

  if (ifModifiedSince) {
    const clientDate = new Date(ifModifiedSince);
    if (lastModified && lastModified <= clientDate) {
      return new NextResponse(null, { status: 304 });
    }
  }

  const response = await getModel().getStopTimeInstances(
    stopId,
    subMinutes(new Date(), 10),
    20
  );

  return Response.json(response, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-cache, no-transform",
      "last-modified": lastModified?.toUTCString() || "",
    },
  });
}
