import "server-only";
import type { profile } from "@agp/shared";
import { AppError } from "@/lib/reliability";
import type { ServerClient } from "@/lib/supabase/server";

export interface UpdateProfileInput {
  displayName?: string;
  /** null clears the avatar; undefined leaves it. */
  avatarUrl?: string | null;
}

/**
 * Updates the signed-in member's own name and avatar (design §5.1). It runs as the member, so
 * row-level security limits it to their own row and those two columns; the profiles trigger copies
 * a new name onto their joined trip_members rows in the same statement, so chat and lanes follow.
 *
 * @param client The caller's session client (`getServerClient()`); never the admin client.
 * @throws AppError `unauthenticated` without a session, `invalid_input` when the database rejects
 *   the values (the same limits as the route's schema).
 */
export async function updateProfile(client: ServerClient, input: UpdateProfileInput): Promise<{ profile: profile.Profile }> {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new AppError("unauthenticated", "Sign in to edit your profile.");

  const patch: { display_name?: string; avatar_url?: string | null } = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName.trim();
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;

  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("id", auth.user.id)
    .select("id, display_name, avatar_url")
    .maybeSingle();
  // 42501 here is the policy's check: a blank or overlong name, or an avatar that isn't a web URL.
  if (error?.code === "42501") throw new AppError("invalid_input", "Use a name of 1 to 80 characters and a web image link.", { cause: error });
  if (error) throw new AppError("internal", "Couldn't save your profile. Try again.", { retryable: true, cause: error });
  // Every user gets a profile at sign-up, so no row means the session's user was deleted.
  if (!data) throw new AppError("unauthenticated", "Sign in to edit your profile.");
  return { profile: data };
}
