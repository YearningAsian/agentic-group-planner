import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { ScriptAdmin } from "./lib/admin";
import { seedStripeCustomers } from "./stripe-customers";

function scenario() {
  const profiles = new Map(["id-1", "id-2", "id-3"].map((id) => [id, {
    id, stripe_customer_id: null as string | null, default_payment_method_id: null as string | null,
  }]));
  const users = { person1: "id-1", person2: "id-2", person3: "id-3" };
  const create = vi.fn(async () => ({ id: `cus_${create.mock.calls.length}` }));
  const retrieve = vi.fn(async (id: string) => ({ id, deleted: false }) as { id: string; deleted: boolean });
  const attach = vi.fn(async () => ({ id: `pm_${attach.mock.calls.length}` }));
  const stripe = { customers: { create, retrieve }, paymentMethods: { attach } } as unknown as Stripe;
  const admin = {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table: ${table}`);
      let id: string;
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(_: string, value: string) { id = value; return query; },
        update(values: Record<string, unknown>) { patch = values; return query; },
        async single() { return { data: { ...profiles.get(id)! }, error: null }; },
        then(resolve: (result: { error: null }) => unknown) {
          if (patch) Object.assign(profiles.get(id)!, patch);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  } as unknown as ScriptAdmin;
  return { admin, stripe, create, retrieve, attach, profiles, users };
}

describe("seedStripeCustomers", () => {
  it("creates three tagged test customers once and reuses the saved cards on a rerun", async () => {
    const s = scenario();
    const opts = { stripe: s.stripe, secretKey: "sk_test_unit" };

    expect(await seedStripeCustomers(s.admin, "dev-co", s.users, opts)).toBe(3);
    expect(s.create).toHaveBeenCalledTimes(3);
    expect(s.create).toHaveBeenNthCalledWith(1, {
      email: "person1.dev-co@demo.agp.test", name: "Person 1",
      metadata: { profile_id: "id-1", demo: "true", seed_batch: "dev-co" },
    }, { idempotencyKey: "seed-customer:dev-co:id-1" });
    expect(s.attach).toHaveBeenNthCalledWith(1, "pm_card_visa", { customer: "cus_1" }, {
      idempotencyKey: "seed-test-card:cus_1:visa",
    });
    expect([...s.profiles.values()].map((p) => [p.stripe_customer_id, p.default_payment_method_id])).toEqual([
      ["cus_1", "pm_1"], ["cus_2", "pm_2"], ["cus_3", "pm_3"],
    ]);

    expect(await seedStripeCustomers(s.admin, "dev-co", s.users, opts)).toBe(0);
    expect(s.create).toHaveBeenCalledTimes(3);
    expect(s.attach).toHaveBeenCalledTimes(3);
  });

  it("fills only a missing card on an existing customer", async () => {
    const s = scenario();
    s.profiles.set("id-1", { id: "id-1", stripe_customer_id: "cus_saved", default_payment_method_id: null });

    await seedStripeCustomers(s.admin, "dev-co", { person1: "id-1" } as typeof s.users, {
      stripe: s.stripe, secretKey: "sk_test_unit",
    });

    expect(s.create).not.toHaveBeenCalled();
    expect(s.attach).toHaveBeenCalledWith("pm_card_visa", { customer: "cus_saved" }, {
      idempotencyKey: "seed-test-card:cus_saved:visa",
    });
    expect(s.profiles.get("id-1")?.default_payment_method_id).toBe("pm_1");
  });

  it("replaces the mock provider's IDs left by a mock-mode run with real test customers", async () => {
    const s = scenario();
    s.profiles.set("id-1", { id: "id-1", stripe_customer_id: "cus_mock_abc123", default_payment_method_id: "pm_mock_visa" });

    expect(await seedStripeCustomers(s.admin, "dev-co", { person1: "id-1" }, { stripe: s.stripe, secretKey: "sk_test_unit" })).toBe(1);

    expect(s.retrieve).not.toHaveBeenCalled();
    expect(s.profiles.get("id-1")).toMatchObject({ stripe_customer_id: "cus_1", default_payment_method_id: "pm_1" });
  });

  it("recreates a customer Stripe no longer has, and never pairs it with the old card", async () => {
    const s = scenario();
    s.profiles.set("id-1", { id: "id-1", stripe_customer_id: "cus_gone", default_payment_method_id: "pm_old" });
    s.retrieve.mockResolvedValueOnce({ id: "cus_gone", deleted: true });

    expect(await seedStripeCustomers(s.admin, "dev-co", { person1: "id-1" }, { stripe: s.stripe, secretKey: "sk_test_unit" })).toBe(1);

    expect(s.profiles.get("id-1")).toMatchObject({ stripe_customer_id: "cus_1", default_payment_method_id: "pm_1" });
    expect(s.attach).toHaveBeenCalledWith("pm_card_visa", { customer: "cus_1" }, { idempotencyKey: "seed-test-card:cus_1:visa" });
  });

  it("persists each customer before attaching its card so reruns do not duplicate it after an error", async () => {
    const s = scenario();
    s.attach.mockRejectedValueOnce(new Error("Stripe attachment failed"));
    const opts = { stripe: s.stripe, secretKey: "sk_test_unit" };

    await expect(seedStripeCustomers(s.admin, "dev-co", { person1: "id-1" }, opts)).rejects.toThrow(/attachment failed/);
    expect(s.profiles.get("id-1")).toMatchObject({ stripe_customer_id: "cus_1", default_payment_method_id: null });
    await seedStripeCustomers(s.admin, "dev-co", { person1: "id-1" }, opts);
    expect(s.create).toHaveBeenCalledOnce();
  });

  it("refuses a non-test key before reaching Stripe", async () => {
    const s = scenario();

    await expect(seedStripeCustomers(s.admin, "dev-co", s.users, {
      stripe: s.stripe, secretKey: "sk_live_rejected",
    })).rejects.toThrow(/test-mode/);
    expect(s.create).not.toHaveBeenCalled();
  });
});
