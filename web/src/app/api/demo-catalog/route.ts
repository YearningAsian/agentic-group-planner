import catalog from "@/lib/demo/city-catalog.json";
import type { Json } from "@agp/shared/db";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

/** The shared city, fare, and stay document. Falls back to the bundled copy if the row is missing. */
export async function GET(): Promise<Response> {
  try {
    const client = await getServerClient();
    const { data, error } = await client.from("demo_catalog").select("document").eq("id", "cities").maybeSingle();
    if (error) throw new AppError("internal", "Couldn't load the city catalog.", { cause: error, retryable: true });
    return Response.json(data?.document ?? (catalog as Json));
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
