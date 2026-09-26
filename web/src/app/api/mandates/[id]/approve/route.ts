import { mandates } from "@agp/shared";
import { approveHold, approverFor } from "@/features/payments/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/**
 * A member approves their hold on a mandate. The body is empty: the server decides every amount,
 * and the organizer's approval always includes the shares they front.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/mandates/[id]/approve">): Promise<Response> {
  const params = mandates.MandateParams.safeParse(await ctx.params);
  if (!params.success) return badRequest("id: must be a purchase ID.");
  const text = await request.text();
  let json: unknown = {};
  if (text.trim() !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      return badRequest("The request body must be JSON.");
    }
  }
  if (!mandates.ApproveBody.safeParse(json).success) return badRequest("The body must be empty: the server decides every amount.");

  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to approve.");
    const mandateId = params.data.id;
    const memberId = await approverFor({ mandateId, profileId: data.user.id });
    const { holds } = await approveHold({ mandateId, memberId });
    return Response.json({ holds } satisfies mandates.ApproveResponse);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
