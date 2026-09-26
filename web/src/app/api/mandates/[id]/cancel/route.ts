import { mandates } from "@agp/shared";
import { cancelByOrganizer } from "@/features/payments/server";
import { mandateAction } from "../action";

/** The organizer cancels a purchase that's still collecting approvals; every hold is released. */
export async function POST(request: Request, ctx: RouteContext<"/api/mandates/[id]/cancel">): Promise<Response> {
  return mandateAction(request, ctx, mandates.CancelBody, async (input) => (await cancelByOrganizer(input)) satisfies mandates.CancelResponse);
}
