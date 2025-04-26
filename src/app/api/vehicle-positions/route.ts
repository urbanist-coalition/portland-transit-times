import { getModel } from "@/lib/model";

export async function GET() {
  const response = await getModel().getVehiclePositionsRaw();
  return new Response(response, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
