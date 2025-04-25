import { getModel } from "@/lib/model";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  let controllerClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const push = (payload: unknown) =>
        controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);

      // send first snapshot
      push(await getModel().getVehiclePositions());

      const quit = getModel().onVehiclePositions((vehiclePositions) => {
        push(vehiclePositions);
      });

      // tidy up if the tab is closed
      req.signal.addEventListener("abort", async () => {
        if (controllerClosed) return;
        controllerClosed = true;
        await quit();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
