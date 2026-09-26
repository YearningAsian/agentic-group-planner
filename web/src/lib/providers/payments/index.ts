import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { createMockPaymentsProvider } from "./mock";
import { createStripePaymentsProvider } from "./real";
import type { PaymentsProvider } from "./types";

export type * from "./types";
export { isMockPaymentId } from "./stripe-config";

/** Picks the implementation from `PAYMENTS_PROVIDER`. Pure, so tests can pass any env. */
export function selectPaymentsProvider(
  env: Pick<ServerEnv, "PAYMENTS_PROVIDER" | "NEXT_PUBLIC_DEMO_MODE"> &
    Partial<Pick<ServerEnv, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET">>,
): PaymentsProvider {
  switch (env.PAYMENTS_PROVIDER) {
    case "mock":
      // The mock's signing secret is public, so only dev mode trusts its webhooks.
      return createMockPaymentsProvider({ acceptWebhooks: env.NEXT_PUBLIC_DEMO_MODE });
    case "real":
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        throw new AppError("invalid_input", "Stripe test credentials are missing.", { retryable: false });
      }
      return createStripePaymentsProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        demoMode: env.NEXT_PUBLIC_DEMO_MODE,
      });
  }
}

let cached: PaymentsProvider | undefined;

/**
 * The provider for this process, chosen once from the validated env. One instance, so the mock's
 * PaymentIntents live as long as the process does.
 */
export function getPaymentsProvider(): PaymentsProvider {
  cached ??= selectPaymentsProvider(getServerEnv());
  return cached;
}
