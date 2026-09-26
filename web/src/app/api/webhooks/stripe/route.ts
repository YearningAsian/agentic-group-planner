import { handleStripeEvent } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsEvent } from "@/lib/providers/payments";
import { toHttpError } from "@/lib/reliability";

/**
 * The payments provider's webhook (design §7.2). The raw body is read before anything parses it,
 * because the signature covers those exact bytes. A bad signature is a 400 and records nothing;
 * a failure while handling is a 500, so the provider retries.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: PaymentsEvent;
  try {
    event = getPaymentsProvider().parseWebhook({ rawBody, signature });
  } catch {
    return Response.json(
      { error: { code: "invalid_input", message: "The webhook signature doesn't match.", retryable: false } },
      { status: 400 },
    );
  }

  try {
    const outcome = await handleStripeEvent(event);
    return Response.json({ received: true, outcome });
  } catch (error) {
    return Response.json(toHttpError(error).body, { status: 500 });
  }
}
