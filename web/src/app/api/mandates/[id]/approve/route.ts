import { mandates } from "@agp/shared";
import { approveHold } from "@/features/payments/server";
import { mandateAction } from "../action";

/**
 * A member approves their hold on a mandate. The body is empty: the server decides every amount,
 * and the organizer's approval always includes the shares they front.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/mandates/[id]/approve">): Promise<Response> {
  return mandateAction(request, ctx, mandates.ApproveBody, async (input) => {
    const { holds } = await approveHold(input);
    return { holds } satisfies mandates.ApproveResponse;
  });
}
