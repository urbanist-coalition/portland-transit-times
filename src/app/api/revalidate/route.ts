import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";

// Called by the worker (src/worker.ts) when GTFS static data changes
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = process.env.REVALIDATE_TOKEN;

  if (token && authHeader !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // The map used to be the page that cached feed-derived data; it is now a
  // static page reading vector tiles, and the tiles are rebuilt by the tile
  // pipeline rather than by this app. What is left to revalidate is everything
  // else rendered from the static feed.
  revalidatePath("/", "layout");

  return Response.json({ revalidated: true, now: Date.now() });
}
