import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

// Called by the worker (src/worker.ts) when GTFS static data changes
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = process.env.REVALIDATE_TOKEN;

  if (token && authHeader !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  revalidatePath("/by-location");

  return Response.json({ revalidated: true, now: Date.now() });
}
