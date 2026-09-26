import type Stripe from "stripe";

/** Match the API version shipped with the pinned stripe@22.6.2 SDK. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
export const STRIPE_OPTIONS = {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 10_000,
} as const satisfies Stripe.StripeConfig;

// The SDK retries individual requests; this outer bound gives its three attempts time to finish.
export const STRIPE_POLICY = { timeoutMs: 40_000, retries: 0 } as const;
