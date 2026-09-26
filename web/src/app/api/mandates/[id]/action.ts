import { mandates } from "@agp/shared";
import type { z } from "zod";
import { approverFor } from "@/features/payments/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/**
 * One member's action on a mandate: approve, decline, cover, or cancel. The body must be empty,
 * because the server decides every amount. The caller acts as their joined member of the mandate's
 * trip; `run` checks anything stricter, like being the organizer.
 */
export async function mandateAction(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  body: z.ZodType,
  run: (input: { mandateId: string; memberId: string }) => Promise<unknown>,
): Promise<Response> {
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
  if (!body.safeParse(json).success) return badRequest("The body must be empty: the server decides every amount.");

  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to act on a purchase.");
    const mandateId = params.data.id;
    const memberId = await approverFor({ mandateId, profileId: data.user.id });
    return Response.json(await run({ mandateId, memberId }));
  } catch (error) {
    const { status, body: errorBody } = toHttpError(error);
    return Response.json(errorBody, { status });
  }
}
