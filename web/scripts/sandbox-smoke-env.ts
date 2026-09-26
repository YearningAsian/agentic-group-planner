/** Checks provider flags before the smoke script creates data or calls any provider. */
export function assertSandboxSmokeEnv(env: Record<string, string | undefined>): void {
  const stripe = env.STRIPE_SECRET_KEY ?? "";
  const duffel = env.DUFFEL_ACCESS_TOKEN ?? "";
  const payments = env.PAYMENTS_PROVIDER || "mock";

  if (stripe.startsWith("sk_live_")) throw new Error("sandbox:smoke refuses a live Stripe key (sk_live_).");
  if (stripe && !stripe.startsWith("sk_test_")) {
    throw new Error("sandbox:smoke needs a test Stripe key (sk_test_) when STRIPE_SECRET_KEY is set.");
  }
  if (duffel && !duffel.startsWith("duffel_test_")) {
    throw new Error("sandbox:smoke refuses a non-test Duffel token.");
  }
  if (payments !== "mock" && payments !== "real") {
    throw new Error('sandbox:smoke needs PAYMENTS_PROVIDER="mock" or "real".');
  }
  if (payments === "real") {
    if (!stripe) throw new Error("sandbox:smoke needs a test Stripe key (sk_test_) for real payments.");
    if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      throw new Error("sandbox:smoke needs a Stripe webhook signing secret (whsec_) for real payments.");
    }
  }
}
