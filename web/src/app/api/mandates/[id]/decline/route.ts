import { mandates } from "@agp/shared";
import { declineHold } from "@/features/payments/server";
import { mandateAction } from "../action";

/** A member declines their share. The organizer then covers the shortfall or cancels (design §4.2). */
export async function POST(request: Request, ctx: RouteContext<"/api/mandates/[id]/decline">): Promise<Response> {
  return mandateAction(request, ctx, mandates.DeclineBody, async (input) => (await declineHold(input)) satisfies mandates.DeclineResponse);
}
