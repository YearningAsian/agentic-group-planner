import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentsProvider } from "@/lib/providers/payments";
import { getAdminClient } from "@/lib/supabase/admin";
import { approveHold } from "./approve-hold";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));

type Hold = {
  id: string;
  mandate_id: string;
  payer_member_id: string;
  share_member_id: string;
  kind: "own" | "fronted";
  status: string;
  cap_cents: number;
  pays_share: boolean | null;
  stripe_payment_intent_id: string | null;
  lease_expires_at: string | null;
  idempotency_key?: string;
};

function scenario(onAuthorized: (state: { mandate: Record<string, unknown>; holds: Hold[] }) => void) {
  const mandate: Record<string, unknown> = {
    id: "mandate", trip_id: "trip", status: "open", currency: "usd",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const member = { id: "person1", trip_id: "trip", profile_id: "profile1", display_name: "Person 1", status: "joined" };
  const profile = { id: "profile1", stripe_customer_id: "cus_person1", default_payment_method_id: "pm_person1" };
  const holds: Hold[] = [{
    id: "own", mandate_id: "mandate", payer_member_id: "person1", share_member_id: "person1", kind: "own",
    status: "pending", cap_cents: 4800, pays_share: null, stripe_payment_intent_id: null, lease_expires_at: null,
    idempotency_key: "share:mandate:person1:own",
  }];
  const releases: { paymentIntentId: string; idempotencyKey: string }[] = [];
  const payments = {
    async authorize() {
      onAuthorized({ mandate, holds });
      return { status: "authorized", paymentIntentId: "pi_late" };
    },
    async release(input: { paymentIntentId: string; idempotencyKey: string }) {
      releases.push(input);
      return { paymentIntentId: input.paymentIntentId };
    },
  } as unknown as PaymentsProvider;

  function from(table: string) {
    const source: Record<string, unknown>[] =
      table === "mandates" ? [mandate] : table === "trip_members" ? [member] : table === "profiles" ? [profile] : holds;
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | undefined;
    const matches = () => source.filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      select() { return builder; },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
      in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
      or() { filters.push((row) => row.lease_expires_at === null); return builder; },
      order() { return builder; },
      // Hold scoping (lib/hold): `eq` for one cover hold, `not.like cover:%` for the main hold.
      filter(column: string, op: string, value: string) {
        filters.push((row) => {
          const actual = String(row[column] ?? "");
          if (op === "eq") return actual === value;
          if (op === "not.like" && value.endsWith("%") && !value.slice(0, -1).includes("%")) return !actual.startsWith(value.slice(0, -1));
          throw new Error(`the fake builder doesn't support filter ${op} ${value}`);
        });
        return builder;
      },
      update(values: Record<string, unknown>) { patch = values; return builder; },
      async maybeSingle() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
      async single() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
      then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) {
        const rows = matches();
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve(resolve({ data: rows.map((row) => ({ ...row })), error: null }));
      },
    };
    return builder;
  }
  vi.mocked(getAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof getAdminClient>);
  return { mandate, holds, payments, releases };
}

beforeEach(() => vi.resetAllMocks());

describe("approveHold after a late authorization", () => {
  it("releases and records an intent that authorized after cancellation released its pending row", async () => {
    const { holds, payments, releases } = scenario(({ mandate, holds }) => {
      mandate.status = "cancelled";
      holds[0]!.status = "released";
      holds[0]!.lease_expires_at = null;
    });

    const result = await approveHold({ mandateId: "mandate", memberId: "person1" }, { payments });

    expect(result.holds).toEqual([{ hold_id: "own", status: "released" }]);
    expect(releases).toEqual([{ paymentIntentId: "pi_late", idempotencyKey: "pi-release:mandate:person1" }]);
    expect(holds[0]!.stripe_payment_intent_id).toBe("pi_late");
  });

  it("keeps an intent that captured a share when another fronted row was excluded", async () => {
    const { holds, payments, releases } = scenario(({ mandate, holds }) => {
      mandate.status = "captured";
      Object.assign(holds[0]!, { status: "captured", pays_share: true, stripe_payment_intent_id: "pi_late" });
      holds[1]!.pays_share = false;
    });
    holds.push({
      ...holds[0]!, id: "fronted", share_member_id: "person4", kind: "fronted",
      status: "pending", pays_share: null, stripe_payment_intent_id: null,
    });

    const result = await approveHold({ mandateId: "mandate", memberId: "person1" }, { payments });

    expect(releases).toEqual([]);
    expect(result.holds).toEqual([{ hold_id: "own", status: "captured" }, { hold_id: "fronted", status: "released" }]);
    expect(holds[0]!.stripe_payment_intent_id).toBe("pi_late");
    expect(holds[1]!.stripe_payment_intent_id).toBe("pi_late");
  });

  it("rejects a pending approval while the mandate is authorized (finalizing)", async () => {
    const { payments } = scenario(() => {});
    const mandate = { id: "mandate", trip_id: "trip", status: "authorized", currency: "usd", expires_at: new Date(Date.now() + 60_000).toISOString() };
    // Rebuild so the mandate starts authorized with a still-pending hold (Person 4 mid-finalize).
    const member = { id: "person4", trip_id: "trip", profile_id: "profile4", display_name: "Person 4", status: "joined" };
    const profile = { id: "profile4", stripe_customer_id: "cus_p4", default_payment_method_id: "pm_p4" };
    const holds: Hold[] = [{
      id: "own", mandate_id: "mandate", payer_member_id: "person4", share_member_id: "person4", kind: "own",
      status: "pending", cap_cents: 4357, pays_share: null, stripe_payment_intent_id: null, lease_expires_at: null,
    }];
    function from(table: string) {
      const source: Record<string, unknown>[] =
        table === "mandates" ? [mandate] : table === "trip_members" ? [member] : table === "profiles" ? [profile] : holds;
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | undefined;
      const matches = () => source.filter((row) => filters.every((filter) => filter(row)));
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
        is(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
        or() { return builder; },
        order() { return builder; },
      // Hold scoping (lib/hold): `eq` for one cover hold, `not.like cover:%` for the main hold.
      filter(column: string, op: string, value: string) {
        filters.push((row) => {
          const actual = String(row[column] ?? "");
          if (op === "eq") return actual === value;
          if (op === "not.like" && value.endsWith("%") && !value.slice(0, -1).includes("%")) return !actual.startsWith(value.slice(0, -1));
          throw new Error(`the fake builder doesn't support filter ${op} ${value}`);
        });
        return builder;
      },
        update(values: Record<string, unknown>) { patch = values; return builder; },
        async maybeSingle() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
        async single() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
        then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) {
          const rows = matches();
          if (patch) for (const row of rows) Object.assign(row, patch);
          return Promise.resolve(resolve({ data: rows.map((row) => ({ ...row })), error: null }));
        },
      };
      return builder;
    }
    vi.mocked(getAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof getAdminClient>);

    await expect(approveHold({ mandateId: "mandate", memberId: "person4" }, { payments })).rejects.toMatchObject({
      code: "conflict",
      retryable: true,
    });
  });

  it("retries finalize when the mandate is authorized and this member has no pending rows", async () => {
    const finalize = vi.fn(async () => undefined);
    const mandate = { id: "mandate", trip_id: "trip", status: "authorized", currency: "usd", expires_at: new Date(Date.now() + 60_000).toISOString() };
    const member = { id: "person1", trip_id: "trip", profile_id: "profile1", display_name: "Person 1", status: "joined" };
    const holds: Hold[] = [{
      id: "own", mandate_id: "mandate", payer_member_id: "person1", share_member_id: "person1", kind: "own",
      status: "authorized", cap_cents: 4800, pays_share: true, stripe_payment_intent_id: "pi_1", lease_expires_at: null,
    }];
    function from(table: string) {
      const source: Record<string, unknown>[] =
        table === "mandates" ? [mandate] : table === "trip_members" ? [member] : holds;
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const matches = () => source.filter((row) => filters.every((filter) => filter(row)));
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
        in() { return builder; },
        is() { return builder; },
        or() { return builder; },
        order() { return builder; },
      // Hold scoping (lib/hold): `eq` for one cover hold, `not.like cover:%` for the main hold.
      filter(column: string, op: string, value: string) {
        filters.push((row) => {
          const actual = String(row[column] ?? "");
          if (op === "eq") return actual === value;
          if (op === "not.like" && value.endsWith("%") && !value.slice(0, -1).includes("%")) return !actual.startsWith(value.slice(0, -1));
          throw new Error(`the fake builder doesn't support filter ${op} ${value}`);
        });
        return builder;
      },
        update() { return builder; },
        async maybeSingle() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
        async single() { return { data: matches()[0] ? { ...matches()[0] } : null, error: null }; },
        then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: matches().map((row) => ({ ...row })), error: null }));
        },
      };
      return builder;
    }
    vi.mocked(getAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof getAdminClient>);

    const payments = { async authorize() { throw new Error("unused"); }, async release() { throw new Error("unused"); } } as unknown as PaymentsProvider;
    const result = await approveHold({ mandateId: "mandate", memberId: "person1" }, { payments, finalize });

    expect(finalize).toHaveBeenCalledWith("mandate");
    expect(result.holds).toEqual([{ hold_id: "own", status: "authorized" }]);
    expect(result.satisfied).toBe(true);
  });
});
