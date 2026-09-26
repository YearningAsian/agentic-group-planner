/** Step 2 of the demo seed: create the three Stripe test customers and attach test cards once. */
import Stripe from "stripe";
import { withPolicy } from "../../src/lib/reliability/with-policy";
import { STRIPE_OPTIONS, STRIPE_POLICY } from "../../src/lib/providers/payments/stripe-config";
import { SEEDED_USERS, type SeededUserKey, seededEmail } from "./fixtures/users";
import type { ScriptAdmin } from "./lib/admin";

interface StripeSeedOptions {
  secretKey?: string;
  /** Tests substitute the external Stripe boundary, while retaining the DB writes. */
  stripe?: Pick<Stripe, "customers" | "paymentMethods">;
}

/** Returns the number of customers created; reruns reuse IDs saved on each profile. */
export async function seedStripeCustomers(
  admin: ScriptAdmin,
  batch: string,
  users: Partial<Record<SeededUserKey, string>>,
  options: StripeSeedOptions = {},
): Promise<number> {
  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey?.startsWith("sk_test_")) throw new Error("Stripe seed requires a test-mode key (sk_test_).");
  const stripe = options.stripe ?? new Stripe(secretKey, STRIPE_OPTIONS);
  let created = 0;

  for (const user of SEEDED_USERS) {
    const profileId = users[user.key];
    if (!profileId) continue;
    const { data: profile, error } = await admin
      .from("profiles")
      .select("stripe_customer_id, default_payment_method_id")
      .eq("id", profileId)
      .single();
    if (error) throw new Error(`seed: reading ${user.key}'s profile failed: ${error.message}`);
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await withPolicy(() => stripe.customers.create({
        email: seededEmail(user.key, batch),
        name: user.displayName,
        metadata: { profile_id: profileId, demo: "true", seed_batch: batch },
      }, { idempotencyKey: `seed-customer:${batch}:${profileId}` }), STRIPE_POLICY);
      customerId = customer.id;
      created++;
      const saved = await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", profileId);
      if (saved.error) throw new Error(`seed: saving ${user.key}'s Stripe customer failed: ${saved.error.message}`);
    }
    let paymentMethodId = profile.default_payment_method_id;
    if (!paymentMethodId) {
      const method = await withPolicy(() => stripe.paymentMethods.attach("pm_card_visa", {
        customer: customerId,
      }, { idempotencyKey: `seed-test-card:${customerId}:visa` }), STRIPE_POLICY);
      paymentMethodId = method.id;
    }
    if (!profile.default_payment_method_id) {
      const saved = await admin.from("profiles").update({ default_payment_method_id: paymentMethodId }).eq("id", profileId);
      if (saved.error) throw new Error(`seed: saving ${user.key}'s Stripe card failed: ${saved.error.message}`);
    }
  }
  return created;
}
