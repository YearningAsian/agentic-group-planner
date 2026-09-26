import { invites } from "@agp/shared";
import { afterClaim, claimInvite } from "@/features/invite/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/** Claims a placeholder's lane for the signed-in caller (design §2.4, §5.3). */
export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("The request body must be JSON.");
  }
  const parsed = invites.ClaimInviteRequest.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(`${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }

  try {
    // The claim runs as the caller, so claim_invite joins whoever holds this session.
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to join this trip.");
    const result = await claimInvite(client, parsed.data.token);
    // The claim is committed; until the handoff lands, the organizer keeps fronting the share.
    await afterClaim(result.memberId).catch((error: unknown) => console.error(`claim ${result.memberId}: after-claim failed`, error));
    return Response.json({ trip_slug: result.tripSlug, member_id: result.memberId } satisfies invites.ClaimInviteResponse);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
