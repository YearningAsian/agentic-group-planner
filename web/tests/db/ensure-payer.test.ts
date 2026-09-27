import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ensurePayer } from "@/features/payments/server";
import { getPaymentsProvider } from "@/lib/providers/payments";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient();

async function joinedMember(): Promise<{ memberId: string; profileId: string }> {
  const user = await createUser({ batch, displayName: "Person 4" });
  const trip = await createTrip(batch, {
    members: [
      { displayName: "Person 4", profileId: user.userId },
      { displayName: "Person 5", inviteToken: `invite-${randomUUID()}` },
    ],
  });
  return { memberId: trip.memberIds[0]!, profileId: user.userId };
}

afterAll(() => cleanup(batch));

describe("ensurePayer", () => {
  it("reuses a stored customer and payment method", async () => {
    const { memberId, profileId } = await joinedMember();
    // Unique, since stripe_customer_id is unique and a crashed run may leave its row behind.
    const customerId = `cus_saved_${randomUUID()}`;
    const saved = await admin.from("profiles").update({
      stripe_customer_id: customerId, default_payment_method_id: "pm_saved",
    }).eq("id", profileId);
    expect(saved.error).toBeNull();

    expect(await ensurePayer(memberId, { demoMode: false })).toEqual({ customerId, paymentMethodId: "pm_saved" });
  });

  it("in dev mode, a claimer without one gets a customer and pm_card_visa", async () => {
    const { memberId, profileId } = await joinedMember();
    const real = getPaymentsProvider();
    const ensureCustomer = vi.fn(real.ensureCustomer.bind(real));
    const payments = { ...real, ensureCustomer };

    const first = await ensurePayer(memberId, { demoMode: true, payments });
    // The mock's stand-in for Stripe's pm_card_visa token.
    expect(first).toMatchObject({ customerId: expect.stringMatching(/^cus_/), paymentMethodId: "pm_mock_visa" });
    const { data: profile } = await admin.from("profiles")
      .select("stripe_customer_id, default_payment_method_id").eq("id", profileId).single();
    expect(profile).toMatchObject({ stripe_customer_id: first.customerId, default_payment_method_id: first.paymentMethodId });
    expect(await ensurePayer(memberId, { demoMode: true, payments })).toEqual(first);
    expect(ensureCustomer).toHaveBeenCalledOnce();
  });

  it("outside dev mode, a member without a payment method gets not_permitted", async () => {
    const { memberId, profileId } = await joinedMember();

    await expect(ensurePayer(memberId, { demoMode: false })).rejects.toMatchObject({ code: "not_permitted" });
    const { data: profile } = await admin.from("profiles")
      .select("stripe_customer_id, default_payment_method_id").eq("id", profileId).single();
    expect(profile).toMatchObject({ stripe_customer_id: null, default_payment_method_id: null });
  });
});
