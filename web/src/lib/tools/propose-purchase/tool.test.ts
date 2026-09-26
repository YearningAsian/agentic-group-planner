import type { ApprovalCard } from "@agp/shared";
import { describe, expect, it, vi } from "vitest";
import { toToolError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import type { RunContext } from "../define-tool";
import { createProposePurchaseTool } from "./tool";

const person = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const itemId = "00000000-0000-4000-8000-0000000000a1";
const chosenOption = "00000000-0000-4000-8000-0000000000b1";
const otherOption = "00000000-0000-4000-8000-0000000000b2";

const memberHold = (n: number) => ({
  payer_member_id: person(n),
  share_member_ids: [person(n)],
  share_cents: 4200,
  processor_fee_cents: 157,
  platform_fee_cents: 0,
  total_cents: 4357,
  cap_cents: 4800,
});

const seededCard: ApprovalCard = {
  card_type: "approval",
  mandate_id: "00000000-0000-4000-8000-0000000000e1",
  item_id: itemId,
  title: "Georgia Aquarium · 4 tickets",
  merchant: "Demo Tickets (mock merchant)",
  quote_cents: 16800,
  cap_cents: 19200,
  currency: "usd",
  expires_at: "2026-09-27T14:00:00.000Z",
  holds: [
    { ...memberHold(1), share_member_ids: [person(1), person(4)], share_cents: 8400, processor_fee_cents: 282, total_cents: 8682, cap_cents: 9600 },
    memberHold(2),
    memberHold(3),
    memberHold(4),
  ],
  shares: [1, 2, 3, 4].map((n) => ({
    member_id: person(n),
    display_name: `Person ${n}`,
    share_cents: 4200,
    cap_cents: 4800,
    covered_by_member_id: n === 4 ? person(1) : null,
  })),
};

/** An admin client that answers the tool's one item lookup. */
function adminWith(item: { status: string; chosen_option_id: string | null; label: string } | null): AdminClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: item, error: null }),
  };
  return { from: () => query } as unknown as AdminClient;
}

function setup(item: { status: string; chosen_option_id: string | null; label: string } | null = { status: "decided", chosen_option_id: chosenOption, label: "Morning" }) {
  const createMandate = vi.fn(async () => ({
    mandateId: seededCard.mandate_id,
    cardMessageId: "00000000-0000-4000-8000-0000000000d1",
    shares: seededCard.shares,
    card: seededCard,
  }));
  const ctx: RunContext = {
    tripId: "00000000-0000-4000-8000-0000000000f0",
    runId: "00000000-0000-4000-8000-0000000000f1",
    toolCallId: "call_abc",
    requesterMemberId: person(2),
    actorMemberId: person(2),
    handles: { M1: person(1), I1: itemId, O1: chosenOption, O2: otherOption },
    admin: adminWith(item),
  };
  const tool = createProposePurchaseTool({ createMandate });
  /** What runTool hands the model: the result, or the correctable error as a ToolError. */
  const call = (input: unknown) =>
    tool.handler(tool.input.parse(input), ctx).catch((error: unknown) => ({ ok: false as const, error: toToolError(error) }));
  return { ctx, createMandate, call };
}

describe("propose_purchase tool", () => {
  it("an item that isn't decided returns invalid_input telling the group to confirm it in comments first", async () => {
    const { call, createMandate } = setup({ status: "voting", chosen_option_id: null, label: "Morning" });
    const result = await call({ item_handle: "I1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "invalid_input", message: expect.stringMatching(/confirm it in the comments first/) });
    expect(createMandate).not.toHaveBeenCalled();

    const booked = await setup({ status: "booked", chosen_option_id: chosenOption, label: "Morning" }).call({ item_handle: "I1" });
    expect(booked.error).toMatchObject({ code: "conflict" });
  });

  it("an unknown handle returns unknown_handle", async () => {
    const { call, createMandate } = setup();
    expect((await call({ item_handle: "I9" })).error).toMatchObject({ code: "unknown_handle" });
    expect((await call({ item_handle: "I1", option_handle: "O9" })).error).toMatchObject({ code: "unknown_handle" });
    expect(createMandate).not.toHaveBeenCalled();
  });

  it("the idempotency key is mandate:{run_id}:{tool_call_id}", async () => {
    const { call, ctx, createMandate } = setup();
    const result = await call({ item_handle: "I1", cap_percent: 115, note: "Timed entry." });
    expect(result).toMatchObject({ ok: true, card_message_id: "00000000-0000-4000-8000-0000000000d1" });
    expect(createMandate).toHaveBeenCalledWith({
      ctx,
      itemId,
      optionId: chosenOption,
      capPercent: 115,
      note: "Timed entry.",
      idempotencyKey: `mandate:${ctx.runId}:call_abc`,
    });

    // A named option replaces the chosen one; the key stays the call's.
    await call({ item_handle: "I1", option_handle: "O2" });
    expect(createMandate).toHaveBeenLastCalledWith(
      expect.objectContaining({ optionId: otherOption, idempotencyKey: `mandate:${ctx.runId}:call_abc` }),
    );
  });

  it("the summary gives each share and cap in dollars", async () => {
    const result = await setup().call({ item_handle: "I1" });
    expect(result.ok).toBe(true);
    const summary = (result as { summary: string }).summary;
    for (const n of [1, 2, 3]) expect(summary).toContain(`Person ${n} $42 (up to $48)`);
    expect(summary).toContain("Person 4 $42 (up to $48), fronted by Person 1 until they join");
    expect(summary).toContain("$168 total, up to $192");
    expect(summary.length).toBeLessThanOrEqual(600);
  });
});
