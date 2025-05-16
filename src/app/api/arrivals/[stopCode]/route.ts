import { getModel } from "@/lib/model";
import { dumbIfModifiedSince, stopCodeToStopId } from "@/lib/utils";
import { subMinutes } from "date-fns";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ stopCode: string }> }
) {
  const { stopCode } = await params;
  if (!stopCode) {
    return new Response("stopCode is required", { status: 400 });
  }

  const stopId = stopCodeToStopId(stopCode.toString());

  const lastModified = await getModel().getStopUpdatedAt(stopId);

  const ifModifiedSince = dumbIfModifiedSince(req);

  if (ifModifiedSince) {
    const clientDate = new Date(ifModifiedSince);
    if (lastModified && lastModified <= clientDate) {
      return new Response(null, { status: 304 });
    }
  }

  const response = await getModel().getStopTimeInstances(
    stopId,
    subMinutes(new Date(), 10),
    20
  );

  return Response.json(response, {
    headers: {
      "last-modified": lastModified?.toUTCString() || "",
    },
  });
}
