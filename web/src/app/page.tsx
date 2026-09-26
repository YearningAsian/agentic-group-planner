import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";

/** The root has no page of its own: signed-in users go to their trips, others to sign-in. */
export default async function Home() {
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getClaims();
  redirect(data?.claims ? "/trips" : "/login");
}
