import "server-only";
import { bundledSampleCatalog, parseSampleCatalog, type SampleCatalog } from "./sample-catalog";
import { getServerClient } from "@/lib/supabase/server";

/** The `demo_catalog` cities row. The bundled JSON is the same document when the row cannot be read. */
export async function loadSampleCatalog(): Promise<SampleCatalog> {
  try {
    const client = await getServerClient();
    const { data, error } = await client.from("demo_catalog").select("document").eq("id", "cities").maybeSingle();
    if (!error) {
      const parsed = parseSampleCatalog(data?.document);
      if (parsed) return parsed;
    }
  } catch {
    // No request cookies, or Supabase is unreachable. The bundled file matches the seed row.
  }
  return bundledSampleCatalog;
}
