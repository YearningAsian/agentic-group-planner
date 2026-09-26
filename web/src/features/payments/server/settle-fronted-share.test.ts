import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentsProvider } from "@/lib/providers/payments";
import { getAdminClient } from "@/lib/supabase/admin";
import { settleFrontedShare } from "./settle-fronted-share";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));

type Hold = {
  id: string;
  mandate_id: string;
  kind: "own" | "fronted";
  status: string;
  share_cents: number;
  share_member_id: string;
  payer_member_id: string | null;
  stripe_payment_intent_id: string | null;
  pays_share: boolean | null;
  captured_cents: number | null;
  refunded_cents: number | null;
  lease_expires_at: string | null;
};

function scenario(fronted: { memberId: string; capturedCents: number | null }[], capturedCents: number) {
  const holds: Hold[] = fronted.flatMap(({ memberId, capturedCents: allocation }) => [
    {
      id: `${memberId}:own`, mandate_id: "mandate", kind: "own", status: "authorized", share_cents: 4200,
      share_member_id: memberId, payer_member_id: memberId, stripe_payment_intent_id: `pi_${memberId}`,
      pays_share: null, captured_cents: null, refunded_cents: null, lease_expires_at: null,
    },
    {
      id: `${memberId}:fronted`, mandate_id: "mandate", kind: "fronted", status: "captured", share_cents: 4200,
      share_member_id: memberId, payer_member_id: "organizer", stripe_payment_intent_id: "pi_organizer",
      pays_share: true, captured_cents: allocation, refunded_cents: null, lease_expires_at: null,
    },
  ]);
  const refunds: { memberId: string; amountCents: number; idempotencyKey: string }[] = [];
  const captures: string[] = [];
  const payments = {
    async capture(input: { paymentIntentId: string }) { captures.push(input.paymentIntentId); return { paymentIntentId: "captured" }; },
    async refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: { share_member_id: string } }) {
      if (input.paymentIntentId !== "pi_organizer") throw new Error("wrong PaymentIntent");
      const prior = refunds.find((r) => r.idempotencyKey === input.idempotencyKey);
      if (prior) {
        if (prior.amountCents !== input.amountCents) throw new Error("idempotency key reused with another amount");
        return { refundId: "existing" };
      }
      if (refunds.reduce((sum, r) => sum + r.amountCents, 0) + input.amountCents > capturedCents) {
        throw new Error("refunds exceed the original capture");
      }
      refunds.push({ memberId: input.metadata.share_member_id, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
      return { refundId: "new" };
    },
  } as unknown as PaymentsProvider;

  function query(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | undefined;
    const builder = {
      select() { return builder; },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
      in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
      or() { filters.push((row) => row.lease_expires_at === null); return builder; },
      update(values: Record<string, unknown>) { patch = values; return builder; },
      async maybeSingle() { return { data: table === "mandates" ? { status: "captured" } : null, error: null }; },
      then(resolve: (result: { data: Hold[]; error: null }) => unknown) {
        const rows = table === "payment_holds" ? holds : [];
        const matches = rows.filter((row) => filters.every((filter) => filter(row as unknown as Record<string, unknown>)));
        if (patch) for (const row of matches) Object.assign(row, patch);
        return Promise.resolve(resolve({ data: matches.map((row) => ({ ...row })), error: null }));
      },
    };
    return builder;
  }
  vi.mocked(getAdminClient).mockReturnValue({ from: query } as unknown as ReturnType<typeof getAdminClient>);
  return { holds, payments, refunds, captures };
}

beforeEach(() => vi.resetAllMocks());

describe("settleFrontedShare refunds", () => {
  it("does not refund when the original fronted capture allocation is missing", async () => {
    const { payments, refunds, captures } = scenario([{ memberId: "person4", capturedCents: null }], 4357);
    await expect(settleFrontedShare({ mandateId: "mandate", memberId: "person4" }, { payments }))
      .rejects.toThrow(/no recorded capture amount/);
    expect(refunds).toEqual([]);
    expect(captures).toEqual([]);
  });

  it("keeps the existing one-placeholder amount of 4325 cents", async () => {
    const { holds, payments, refunds } = scenario([{ memberId: "person4", capturedCents: 4325 }], 8682);
    holds.push({
      id: "organizer:own", mandate_id: "mandate", kind: "own", status: "captured", share_cents: 4200,
      share_member_id: "organizer", payer_member_id: "organizer", stripe_payment_intent_id: "pi_organizer",
      pays_share: true, captured_cents: 4357, refunded_cents: null, lease_expires_at: null,
    });

    expect(await settleFrontedShare({ mandateId: "mandate", memberId: "person4" }, { payments })).toEqual({ refundedCents: 4325 });
    expect(refunds.map((r) => r.amountCents)).toEqual([4325]);
    expect(holds.find((r) => r.id === "person4:fronted")).toMatchObject({ status: "refunded", refunded_cents: 4325 });
  });

  it.each([[["person4", "person5"]], [["person5", "person4"]]])(
    "two fronted shares settled in order %j refund their stored portions exactly once",
    async (order) => {
      const { holds, payments, refunds } = scenario([
        { memberId: "person4", capturedCents: 4357 },
        { memberId: "person5", capturedCents: 4325 },
      ], 8682);
      for (const memberId of order) {
        await settleFrontedShare({ mandateId: "mandate", memberId }, { payments });
        expect(await settleFrontedShare({ mandateId: "mandate", memberId }, { payments })).toEqual({ refundedCents: 0 });
      }
      expect(refunds.map((r) => [r.memberId, r.amountCents]).sort()).toEqual([
        ["person4", 4357], ["person5", 4325],
      ]);
      expect(refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(8682);
      expect(holds.filter((r) => r.kind === "fronted").map((r) => r.status)).toEqual(["refunded", "refunded"]);
    },
  );

  it("two fronted shares settling concurrently stay within the original capture", async () => {
    const { payments, refunds } = scenario([
      { memberId: "person4", capturedCents: 4357 },
      { memberId: "person5", capturedCents: 4325 },
    ], 8682);
    const results = await Promise.all(["person5", "person4"].map((memberId) => settleFrontedShare({ mandateId: "mandate", memberId }, { payments })));
    expect(results.map((r) => r.refundedCents).sort((a, b) => a - b)).toEqual([4325, 4357]);
    expect(refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(8682);
  });
});
