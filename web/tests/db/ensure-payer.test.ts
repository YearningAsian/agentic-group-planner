import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ensurePayer } from "@/features/payments/server";
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
    const saved = await admin.from("profiles").update({
      stripe_customer_id: "cus_saved", default_payment_method_id: "pm_saved",
    }).eq("id", profileId);
    expect(saved.error).toBeNull();

    expect(await ensurePayer(memberId, { demoMode: false })).toEqual({ customerId: "cus_saved", paymentMethodId: "pm_saved" });
  });

  it("attaches a test card to a joined claimer in demo mode and persists the IDs", async () => {
    const { memberId, profileId } = await joinedMember();

    const first = await ensurePayer(memberId, { demoMode: true });
    expect(first.customerId).toMatch(/^cus_/);
    expect(first.paymentMethodId).toMatch(/^pm_/);
    const { data: profile } = await admin.from("profiles")
      .select("stripe_customer_id, default_payment_method_id").eq("id", profileId).single();
    expect(profile).toMatchObject({ stripe_customer_id: first.customerId, default_payment_method_id: first.paymentMethodId });
    expect(await ensurePayer(memberId, { demoMode: true })).toEqual(first);
  });

  it("refuses a member without a payment method outside demo mode", async () => {
    const { memberId, profileId } = await joinedMember();

    await expect(ensurePayer(memberId, { demoMode: false })).rejects.toMatchObject({ code: "not_permitted" });
    const { data: profile } = await admin.from("profiles")
      .select("stripe_customer_id, default_payment_method_id").eq("id", profileId).single();
    expect(profile).toMatchObject({ stripe_customer_id: null, default_payment_method_id: null });
  });
});
