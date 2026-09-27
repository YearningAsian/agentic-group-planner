import "server-only";
import { AppError, type AppErrorCode } from "@/lib/reliability";
import type { ServerClient } from "@/lib/supabase/server";

export interface ClaimInviteResult {
  tripSlug: string;
  /** The claimed trip_members row, now joined with the caller's profile. */
  memberId: string;
}

const SIGN_IN: [AppErrorCode, string] = ["unauthenticated", "Sign in to join this trip."];

/** The copy the invite page shows for each outcome (VO-210), keyed by claim_invite's error code. */
const CLAIM_ERRORS: Record<string, [AppErrorCode, string]> = {
  unauthenticated: SIGN_IN,
  not_found: ["not_found", "Invite not found."],
  already_used: ["conflict", "This invite was already used."],
  already_member: ["conflict", "You're already a member of this trip."],
};

function claimError(error: { message: string; code?: string }): AppError {
  const known = CLAIM_ERRORS[/^([a-z_]+):/.exec(error.message)?.[1] ?? ""];
  // A signed-out client can't execute the function at all, so Postgres denies it before it runs.
  const [code, message] = known ?? (error.code === "42501" ? SIGN_IN : undefined) ?? [];
  if (code && message) return new AppError(code, message, { cause: error });
  return new AppError("internal", "Couldn't join the trip. Try again.", { retryable: true, cause: error });
}

/**
 * Claims a placeholder's lane for the signed-in caller (design §5.3) through `claim_invite`, which
 * runs as the caller, so `auth.uid()` is who joins. A token claims exactly once: a second claim,
 * even from the claimer's own other device, gets "This invite was already used." (review focus 4).
 *
 * @param client The caller's session client (`getServerClient()`); never the admin client.
 * @throws AppError `unauthenticated`, `not_found`, or `conflict` (used, or already a member).
 */
export async function claimInvite(client: ServerClient, token: string): Promise<ClaimInviteResult> {
  if (token.trim() === "") {
    throw new AppError("not_found", "Invite not found.");
  }
  const { data, error } = await client.rpc("claim_invite", { p_token: token });
  if (error) throw claimError(error);
  const result = data as { trip_slug: string; member_id: string };
  return { tripSlug: result.trip_slug, memberId: result.member_id };
}
