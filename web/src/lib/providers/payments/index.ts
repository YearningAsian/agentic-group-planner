import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { NotBuiltError } from "@/lib/not-built";
import { createMockPaymentsProvider } from "./mock";
import type { PaymentsProvider } from "./types";

export type * from "./types";

/** Picks the implementation from `PAYMENTS_PROVIDER`. Pure, so tests can pass any env. */
export function selectPaymentsProvider(env: Pick<ServerEnv, "PAYMENTS_PROVIDER" | "NEXT_PUBLIC_DEMO_MODE">): PaymentsProvider {
  switch (env.PAYMENTS_PROVIDER) {
    case "mock":
      // The mock's signing secret is public, so only dev mode trusts its webhooks.
      return createMockPaymentsProvider({ acceptWebhooks: env.NEXT_PUBLIC_DEMO_MODE });
    case "real":
      throw new NotBuiltError("The Stripe payments adapter (CO-301)");
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
