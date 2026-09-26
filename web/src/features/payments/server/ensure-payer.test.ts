import { describe, expect, it, vi } from "vitest";
import type { PaymentsProvider } from "@/lib/providers/payments";
import type { AdminClient } from "@/lib/supabase/admin";
import { ensurePayer } from "./ensure-payer";

function scenario(
  saved: { stripe_customer_id: string | null; default_payment_method_id: string | null },
  status: "joined" | "placeholder" = "joined",
) {
  const member = { id: "member-1", profile_id: "profile-1", display_name: "Person 4", status };
  const profile = { id: "profile-1", ...saved };
  const ensureCustomer = vi.fn(async () => ({ customerId: "cus_new" }));
  const attachTestCard = vi.fn(async () => ({ paymentMethodId: "pm_new" }));
  const payments = { name: "real", ensureCustomer, attachTestCard } as unknown as PaymentsProvider;
  const admin = {
    from(table: string) {
      const row = table === "trip_members" ? member : profile;
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq() { return query; },
        update(values: Record<string, unknown>) { patch = values; return query; },
        async maybeSingle() { return { data: { ...row }, error: null }; },
        async single() { return { data: { ...row }, error: null }; },
        then(resolve: (result: { error: null }) => unknown) {
          if (patch) Object.assign(row, patch);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  } as unknown as AdminClient;
  return { admin, payments, profile, ensureCustomer, attachTestCard };
}

describe("ensurePayer", () => {
  it("reuses a stored customer and payment method without calling Stripe", async () => {
    const s = scenario({ stripe_customer_id: "cus_saved", default_payment_method_id: "pm_saved" });

    expect(await ensurePayer("member-1", { ...s, demoMode: false })).toEqual({
      customerId: "cus_saved", paymentMethodId: "pm_saved",
    });
    expect(s.ensureCustomer).not.toHaveBeenCalled();
    expect(s.attachTestCard).not.toHaveBeenCalled();
  });

  it("creates a customer and test card for a claimer in demo mode, then reuses them", async () => {
    const s = scenario({ stripe_customer_id: null, default_payment_method_id: null });

    expect(await ensurePayer("member-1", { ...s, demoMode: true })).toEqual({ customerId: "cus_new", paymentMethodId: "pm_new" });
    expect(s.profile).toMatchObject({ stripe_customer_id: "cus_new", default_payment_method_id: "pm_new" });
    expect(await ensurePayer("member-1", { ...s, demoMode: true })).toEqual({ customerId: "cus_new", paymentMethodId: "pm_new" });
    expect(s.ensureCustomer).toHaveBeenCalledOnce();
    expect(s.ensureCustomer).toHaveBeenCalledWith({ profileId: "profile-1", name: "Person 4" });
    expect(s.attachTestCard).toHaveBeenCalledOnce();
    expect(s.attachTestCard).toHaveBeenCalledWith({ customerId: "cus_new", card: "visa" });
  });

  it("never attaches a test card outside demo mode", async () => {
    const s = scenario({ stripe_customer_id: "cus_saved", default_payment_method_id: null });

    await expect(ensurePayer("member-1", { ...s, demoMode: false })).rejects.toMatchObject({ code: "not_permitted" });
    expect(s.profile.default_payment_method_id).toBeNull();
    expect(s.attachTestCard).not.toHaveBeenCalled();
  });

  it("persists a new customer before card attachment so a retry does not create another", async () => {
    const s = scenario({ stripe_customer_id: null, default_payment_method_id: null });
    s.attachTestCard.mockRejectedValueOnce(new Error("Stripe card attachment failed"));

    await expect(ensurePayer("member-1", { ...s, demoMode: true })).rejects.toThrow(/attachment failed/);
    expect(s.profile).toMatchObject({ stripe_customer_id: "cus_new", default_payment_method_id: null });
    await expect(ensurePayer("member-1", { ...s, demoMode: true })).resolves.toEqual({
      customerId: "cus_new", paymentMethodId: "pm_new",
    });
    expect(s.ensureCustomer).toHaveBeenCalledOnce();
  });

  it("on Stripe, the mock provider's IDs count as missing: demo mode provisions real ones", async () => {
    const s = scenario({ stripe_customer_id: "cus_mock_abc123", default_payment_method_id: "pm_mock_visa" });

    expect(await ensurePayer("member-1", { ...s, demoMode: true })).toEqual({ customerId: "cus_new", paymentMethodId: "pm_new" });
    expect(s.profile).toMatchObject({ stripe_customer_id: "cus_new", default_payment_method_id: "pm_new" });
  });

  it("on Stripe, mock IDs outside demo mode are refused, not sent to Stripe", async () => {
    const s = scenario({ stripe_customer_id: "cus_mock_abc123", default_payment_method_id: "pm_mock_visa" });

    await expect(ensurePayer("member-1", { ...s, demoMode: false })).rejects.toMatchObject({ code: "not_permitted" });
    expect(s.ensureCustomer).not.toHaveBeenCalled();
  });

  it("a new customer always gets a new card, never the stored one", async () => {
    const s = scenario({ stripe_customer_id: null, default_payment_method_id: "pm_orphan" });

    expect(await ensurePayer("member-1", { ...s, demoMode: true })).toEqual({ customerId: "cus_new", paymentMethodId: "pm_new" });
    expect(s.attachTestCard).toHaveBeenCalledWith({ customerId: "cus_new", card: "visa" });
  });

  it("does not provision a placeholder before they join", async () => {
    const s = scenario({ stripe_customer_id: null, default_payment_method_id: null }, "placeholder");

    await expect(ensurePayer("member-1", { ...s, demoMode: true })).rejects.toMatchObject({ code: "not_permitted" });
    expect(s.ensureCustomer).not.toHaveBeenCalled();
  });
});
