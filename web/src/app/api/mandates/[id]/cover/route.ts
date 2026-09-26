import { mandates } from "@agp/shared";
import { coverShortfall } from "@/features/payments/server";
import { mandateAction } from "../action";

/** The organizer covers every declined share on cover holds of their own (design §4.2). */
export async function POST(request: Request, ctx: RouteContext<"/api/mandates/[id]/cover">): Promise<Response> {
  return mandateAction(request, ctx, mandates.CoverBody, async (input) => (await coverShortfall(input)) satisfies mandates.CoverResponse);
}
