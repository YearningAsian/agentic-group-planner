import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_MERCHANT_NAME } from "@/lib/providers/booking/mock-merchant";
import type { PaymentsEvent } from "@/lib/providers/payments";
import { finishWebhook, recordWebhook } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";
import { finalizeIfWon, isSatisfied } from "./approve-hold";
import { finalizeMandate } from "./finalize-mandate";
import { handleStripeEvent } from "./handle-stripe-event";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/reliability", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reliability")>("@/lib/reliability");
  return { ...actual, recordWebhook: vi.fn(), finishWebhook: vi.fn() };
});
vi.mock("./approve-hold", () => ({
  isSatisfied: vi.fn(),
  finalizeIfWon: vi.fn(async (_admin: unknown, mandateId: string, deps: unknown) => {
    const { finalizeMandate } = await import("./finalize-mandate");
    await finalizeMandate(mandateId, deps as never);
  }),
}));
vi.mock("./finalize-mandate", () => ({
  finalizeMandate: vi.fn(),
}));

type Row = Record<string, unknown>;

function ledger() {
  const mandate: Row = { id: "mandate", status: "open", merchant: MOCK_MERCHANT_NAME };
  const holds: Row[] = [
    { id: "h1", mandate_id: "mandate", payer_member_id: "person1", share_member_id: "person1", status: "pending", pays_share: null, idempotency_key: "share:mandate:person1:own" },
    { id: "h2", mandate_id: "mandate", payer_member_id: "person2", share_member_id: "person2", status: "pending", pays_share: null, idempotency_key: "share:mandate:person2:own" },
  ];
  function from(table: string) {
    const source = table === "mandates" ? [mandate] : holds;
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | undefined;
    const matches = () => source.filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      filter(column: string, op: string, value: string) {
        filters.push((row) => {
          const actual = String(row[column] ?? "");
          if (op === "eq") return actual === value;
          if (op === "not.like" && value.endsWith("%")) return !actual.startsWith(value.slice(0, -1));
          throw new Error(`unsupported filter ${op}`);
        });
        return builder;
      },
      update(values: Row) {
        patch = values;
        return builder;
      },
      async maybeSingle() {
        return { data: matches()[0] ? { ...matches()[0] } : null, error: null };
      },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        const rows = matches();
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve(resolve({ data: rows.map((row) => ({ ...row })), error: null }));
      },
    };
    return builder;
  }
  vi.mocked(getAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof getAdminClient>);
  return { mandate, holds };
}

function event(type: string, payer: string, extra: Partial<PaymentsEvent> = {}): PaymentsEvent {
  return {
    id: `evt_${type}_${payer}`,
    type,
    paymentIntentId: `pi_${payer}`,
    status: type === "payment_intent.payment_failed" ? "requires_payment_method" : "requires_capture",
    metadata: { mandate_id: "mandate", payer_member_id: payer, trip_id: "trip", share_member_id: payer },
    declineCode: type === "payment_intent.payment_failed" ? "generic_decline" : null,
    refunds: [],
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordWebhook).mockResolvedValue("process");
  vi.mocked(finishWebhook).mockResolvedValue(undefined);
  vi.mocked(finalizeMandate).mockResolvedValue({ status: "captured" });
});

describe("handleStripeEvent group capture", () => {
  it("authorizes one hold without finalizing, then finalizes once when the last share is ready", async () => {
    const { holds } = ledger();
    vi.mocked(isSatisfied).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await handleStripeEvent(event("payment_intent.amount_capturable_updated", "person1"));
    expect(holds[0]).toMatchObject({ status: "authorized", stripe_payment_intent_id: "pi_person1" });
    expect(holds[1]!.status).toBe("pending");
    expect(finalizeIfWon).not.toHaveBeenCalled();
    expect(finalizeMandate).not.toHaveBeenCalled();

    await handleStripeEvent(event("payment_intent.amount_capturable_updated", "person2"));
    expect(finalizeMandate).toHaveBeenCalledTimes(1);
    expect(finalizeIfWon).toHaveBeenCalledWith(
      expect.anything(),
      "mandate",
      expect.objectContaining({ booking: expect.objectContaining({ merchantName: MOCK_MERCHANT_NAME }) }),
    );

    vi.mocked(recordWebhook).mockResolvedValue("skip");
    await handleStripeEvent(event("payment_intent.amount_capturable_updated", "person2"));
    expect(finalizeMandate).toHaveBeenCalledTimes(1);
  });

  it("resumes finalizeMandate when the mandate is already authorized", async () => {
    const { mandate } = ledger();
    mandate.status = "authorized";
    vi.mocked(isSatisfied).mockResolvedValue(true);
    await handleStripeEvent(event("payment_intent.amount_capturable_updated", "person1"));
    expect(finalizeIfWon).not.toHaveBeenCalled();
    expect(finalizeMandate).toHaveBeenCalledTimes(1);
    expect(finalizeMandate).toHaveBeenCalledWith("mandate", expect.objectContaining({ booking: expect.objectContaining({ merchantName: MOCK_MERCHANT_NAME }) }));
  });

  it("a decline marks the mandate partially_declined and does not capture", async () => {
    const { mandate, holds } = ledger();
    await handleStripeEvent(event("payment_intent.payment_failed", "person2"));
    expect(holds[1]).toMatchObject({ status: "declined", decline_code: "generic_decline" });
    expect(mandate.status).toBe("partially_declined");
    expect(isSatisfied).not.toHaveBeenCalled();
    expect(finalizeIfWon).not.toHaveBeenCalled();
    expect(finalizeMandate).not.toHaveBeenCalled();
  });
});
