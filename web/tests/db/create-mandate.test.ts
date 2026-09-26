import { randomUUID } from "node:crypto";
import { ApprovalCard } from "@agp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreateMandateInput, createMandate as createMandateWithKey } from "@/features/payments/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

/** As propose_purchase calls it: one mandate per tool call (design §7.1). */
const createMandate = (input: Omit<CreateMandateInput, "idempotencyKey">) =>
  createMandateWithKey({ ...input, idempotencyKey: `mandate:${input.ctx.runId}:${input.ctx.toolCallId}` });

const batch = testBatch();
const admin = adminClient();
let users: TestUser[];
let aquarium: string;

interface Trip {
  tripId: string;
  /** Person 1 (organizer) to Person 4 (placeholder). */
  memberIds: string[];
  itemId: string;
  optionId: string;
  runId: string;
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert({ seed_batch: batch, ...row }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/**
 * The seeded shape: four attendees at a decided $42 aquarium visit, Person 4 still a placeholder,
 * and a run that Person 2 started.
 */
async function decidedTrip(): Promise<Trip> {
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: users[0]!.userId },
      { displayName: "Person 2", profileId: users[1]!.userId },
      { displayName: "Person 3", profileId: users[2]!.userId },
      { displayName: "Person 4" },
    ],
  });
  const itemId = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: "morning",
    label: "Morning",
    category: "activity",
    starts_at: "2026-09-26T14:00:00Z",
    ends_at: "2026-09-26T16:30:00Z",
    position: 1,
    status: "voting",
  });
  const optionId = await insert("item_options", {
    trip_id: tripId,
    item_id: itemId,
    place_id: aquarium,
    rank: 1,
    price_cents: 4200,
    score: 0.8,
    score_breakdown: {},
    source: "mock",
  });
  const decided = await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: optionId }).eq("id", itemId);
  if (decided.error) throw decided.error;
  const attendees = memberIds.map((member_id) => ({ item_id: itemId, member_id, trip_id: tripId, seed_batch: batch }));
  const attending = await admin.from("item_attendees").insert(attendees);
  if (attending.error) throw attending.error;
  const runId = await insert("agent_runs", {
    trip_id: tripId,
    trigger: "mention",
    requester_member_id: memberIds[1],
    status: "running",
    provider: "mock",
    model: "muse-spark-1.3",
  });
  return { tripId, memberIds, itemId, optionId, runId };
}

/** A started propose_purchase call, as the runner records it before the handler runs. */
async function toolCall(trip: Trip) {
  const toolCallId = `call_${randomUUID()}`;
  await insert("tool_calls", {
    trip_id: trip.tripId,
    run_id: trip.runId,
    tool_call_id: toolCallId,
    tool_name: "propose_purchase",
    input: { item_handle: "I1" },
    status: "started",
  });
  return {
    ctx: { tripId: trip.tripId, runId: trip.runId, toolCallId, actorMemberId: trip.memberIds[1]!, admin: getAdminClient() },
    toolCallId,
  };
}

async function rows(table: string, column: string, value: string) {
  const { data, error } = await admin.from(table).select("*").eq(column, value);
  if (error) throw error;
  return data as Record<string, unknown>[];
}

/** A hand-built create_mandate payload, for calls that go straight to the SQL function. */
function rawPayload(trip: Trip, toolCallId: string, overrides: { actorMemberId?: string; itemId?: string } = {}) {
  const [p1, p2, p3, p4] = trip.memberIds as [string, string, string, string];
  const mandateId = randomUUID();
  const own = (member: string, joined: boolean) => ({
    share_member_id: member,
    payer_member_id: joined ? member : null,
    kind: "own",
    share_cents: 4200,
    cap_cents: 4800,
    status: joined ? "pending" : "awaiting_member",
  });
  return {
    trip_id: trip.tripId,
    actor_member_id: overrides.actorMemberId ?? p2,
    run_id: trip.runId,
    tool_call_id: toolCallId,
    mandate: {
      id: mandateId,
      item_id: overrides.itemId ?? trip.itemId,
      option_id: trip.optionId,
      merchant: "Demo Tickets (mock merchant)",
      title: "Test · 4 tickets",
      quote_id: "q_test",
      quote_cents: 16800,
      cap_cents: 19200,
      currency: "usd",
      expires_at: "2026-09-27T14:00:00Z",
      idempotency_key: `mandate:${trip.runId}:${toolCallId}`,
    },
    shares: [
      own(p1, true),
      own(p2, true),
      own(p3, true),
      own(p4, false),
      { share_member_id: p4, payer_member_id: p1, kind: "fronted", share_cents: 4200, cap_cents: 4800, status: "pending" },
    ],
    card: { card_type: "approval", mandate_id: mandateId, shares: [] },
    result_summary: "test",
  };
}

beforeAll(async () => {
  users = [];
  for (const n of [1, 2, 3]) users.push(await createUser({ batch, displayName: `Person ${n}` }));
  aquarium = (await createPlace(batch, { name: "Georgia Aquarium" })).placeId;
});

afterAll(() => cleanup(batch));

describe("create_mandate", () => {
  it("four attendees with Person 4 as a placeholder give own rows pending for Persons 1–3, Person 4's own row awaiting_member, and a fronted row for Person 4's share whose payer is Person 1", async () => {
    const trip = await decidedTrip();
    const { ctx } = await toolCall(trip);
    const { mandateId } = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId });

    const [p1, p2, p3, p4] = trip.memberIds;
    const holds = await rows("payment_holds", "mandate_id", mandateId);
    const view = holds
      .map((h) => ({ share: h.share_member_id, payer: h.payer_member_id, kind: h.kind, status: h.status, key: h.idempotency_key }))
      .sort((a, b) => trip.memberIds.indexOf(a.share as string) - trip.memberIds.indexOf(b.share as string) || String(a.kind).localeCompare(String(b.kind)));
    expect(view).toEqual([
      { share: p1, payer: p1, kind: "own", status: "pending", key: `share:${mandateId}:${p1}:own` },
      { share: p2, payer: p2, kind: "own", status: "pending", key: `share:${mandateId}:${p2}:own` },
      { share: p3, payer: p3, kind: "own", status: "pending", key: `share:${mandateId}:${p3}:own` },
      { share: p4, payer: p1, kind: "fronted", status: "pending", key: `share:${mandateId}:${p4}:fronted` },
      { share: p4, payer: null, kind: "own", status: "awaiting_member", key: `share:${mandateId}:${p4}:own` },
    ]);

    const [mandate] = await rows("mandates", "id", mandateId);
    expect(mandate).toMatchObject({
      status: "open",
      item_id: trip.itemId,
      option_id: trip.optionId,
      merchant: "Demo Tickets (mock merchant)",
      title: "Georgia Aquarium · 4 tickets",
      currency: "usd",
      proposed_by_run_id: trip.runId,
      idempotency_key: `mandate:${trip.runId}:${ctx.toolCallId}`,
    });
    // Approvals stay open for a day; the merchant's quote is only good for 15 minutes.
    const approvalWindow = Date.parse(mandate!.expires_at as string) - Date.parse(mandate!.created_at as string);
    expect(Math.abs(approvalWindow - 24 * 3600_000)).toBeLessThan(60_000);
  });

  it("quote 16800, shares 4200, share caps 4800, total cap 19200, and Person 1's hold cap 9600", async () => {
    const trip = await decidedTrip();
    const { ctx } = await toolCall(trip);
    const { mandateId, shares } = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId });

    const [mandate] = await rows("mandates", "id", mandateId);
    expect(mandate).toMatchObject({ quote_cents: 16800, cap_cents: 19200, final_cents: null });
    expect(shares.map((s) => [s.display_name, s.share_cents, s.cap_cents])).toEqual([
      ["Person 1", 4200, 4800],
      ["Person 2", 4200, 4800],
      ["Person 3", 4200, 4800],
      ["Person 4", 4200, 4800],
    ]);
    expect(shares.map((s) => s.covered_by_member_id)).toEqual([null, null, null, trip.memberIds[0]]);

    const holds = await rows("payment_holds", "mandate_id", mandateId);
    const person1 = holds.filter((h) => h.payer_member_id === trip.memberIds[0]);
    expect(person1.reduce((sum, h) => sum + (h.cap_cents as number), 0)).toBe(9600);
    expect(holds.every((h) => h.share_cents === 4200 && h.cap_cents === 4800)).toBe(true);
  });

  it("the card's holds come from holdFees: 4357 for each member's hold, 8682 for Person 1's with Person 4's share", async () => {
    const trip = await decidedTrip();
    const { ctx } = await toolCall(trip);
    const { cardMessageId } = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId });

    const [message] = await rows("messages", "id", cardMessageId);
    const card = ApprovalCard.parse(message!.card_payload);
    const [p1, p2, p3, p4] = trip.memberIds as [string, string, string, string];
    const fees = (total: number) => ({ total_cents: total, platform_fee_cents: 0 });
    expect(card.holds).toEqual([
      { payer_member_id: p1, share_member_ids: [p1, p4], share_cents: 8400, processor_fee_cents: 282, cap_cents: 9600, ...fees(8682) },
      { payer_member_id: p2, share_member_ids: [p2], share_cents: 4200, processor_fee_cents: 157, cap_cents: 4800, ...fees(4357) },
      { payer_member_id: p3, share_member_ids: [p3], share_cents: 4200, processor_fee_cents: 157, cap_cents: 4800, ...fees(4357) },
      // Person 4's own hold, for when they join and approve.
      { payer_member_id: p4, share_member_ids: [p4], share_cents: 4200, processor_fee_cents: 157, cap_cents: 4800, ...fees(4357) },
    ]);
  });

  it("rejects a non-member actor with not_permitted", async () => {
    const trip = await decidedTrip();
    const { toolCallId } = await toolCall(trip);
    const other = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: users[1]!.userId }] });

    const { error } = await admin.rpc("create_mandate", { payload: rawPayload(trip, toolCallId, { actorMemberId: other.memberIds[0] }) });
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not_permitted/);
    // A placeholder of this very trip isn't a joined member either.
    const placeholder = await admin.rpc("create_mandate", { payload: rawPayload(trip, toolCallId, { actorMemberId: trip.memberIds[3] }) });
    expect(placeholder.error?.message).toMatch(/not_permitted/);
    expect(await rows("mandates", "trip_id", trip.tripId)).toEqual([]);

    // The wrapper surfaces it as an AppError.
    const { ctx } = await toolCall(trip);
    await expect(
      createMandate({ ctx: { ...ctx, actorMemberId: other.memberIds[0]! }, itemId: trip.itemId, optionId: trip.optionId }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("rejects a payload naming an item from another trip, and the authenticated role can't execute it", async () => {
    const trip = await decidedTrip();
    const other = await decidedTrip();
    const { toolCallId } = await toolCall(trip);
    const crossTrip = await admin.rpc("create_mandate", { payload: rawPayload(trip, toolCallId, { itemId: other.itemId }) });
    expect(crossTrip.error?.message).toMatch(/not_permitted/);

    const asMember = await users[1]!.client.rpc("create_mandate", { payload: rawPayload(trip, toolCallId) });
    expect(asMember.error?.code).toBe("42501");
    expect(await rows("mandates", "trip_id", trip.tripId)).toEqual([]);
    expect(await rows("mandates", "trip_id", other.tripId)).toEqual([]);
  });

  it("the same idempotency key returns the same mandate", async () => {
    const trip = await decidedTrip();
    const { ctx } = await toolCall(trip);
    const first = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId });
    const second = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId });

    expect(second).toEqual(first);
    expect(await rows("mandates", "trip_id", trip.tripId)).toHaveLength(1);
    expect(await rows("payment_holds", "trip_id", trip.tripId)).toHaveLength(5);
    expect(await rows("messages", "trip_id", trip.tripId)).toHaveLength(1);

    const [call] = await rows("tool_calls", "tool_call_id", ctx.toolCallId);
    expect(call).toMatchObject({ status: "succeeded", message_id: first.cardMessageId });
    expect(call!.output).toMatchObject({ ok: true, card_message_id: first.cardMessageId });
  });

  it("a second live mandate for the item is rejected", async () => {
    const trip = await decidedTrip();
    const first = await toolCall(trip);
    await createMandate({ ctx: first.ctx, itemId: trip.itemId, optionId: trip.optionId });

    const second = await toolCall(trip);
    await expect(createMandate({ ctx: second.ctx, itemId: trip.itemId, optionId: trip.optionId })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await rows("mandates", "trip_id", trip.tripId)).toHaveLength(1);
    expect(await rows("messages", "trip_id", trip.tripId)).toHaveLength(1);
    const [call] = await rows("tool_calls", "tool_call_id", second.toolCallId);
    expect(call!.status).toBe("started");
  });

  it("concurrent calls create one mandate: the same tool call replays it, and another tool call gets conflict", async () => {
    const trip = await decidedTrip();
    const same = await toolCall(trip);
    const replays = await Promise.all([1, 2, 3].map(() => createMandate({ ctx: same.ctx, itemId: trip.itemId, optionId: trip.optionId })));
    expect(new Set(replays.map((r) => r.mandateId)).size).toBe(1);

    const racer = await decidedTrip();
    const calls = await Promise.all([1, 2, 3].map(() => toolCall(racer)));
    const outcomes = await Promise.allSettled(
      calls.map(({ ctx }) => createMandate({ ctx, itemId: racer.itemId, optionId: racer.optionId })),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const o of outcomes.filter((o) => o.status === "rejected")) expect(o.reason).toMatchObject({ code: "conflict" });
    expect(await rows("mandates", "trip_id", racer.tripId)).toHaveLength(1);
    expect(await rows("payment_holds", "trip_id", racer.tripId)).toHaveLength(5);
  });

  it("an item that isn't decided is rejected before anything is written", async () => {
    const trip = await decidedTrip();
    await admin.from("itinerary_items").update({ status: "booked" }).eq("id", trip.itemId);
    const { ctx } = await toolCall(trip);
    await expect(createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId })).rejects.toMatchObject({ code: "conflict" });
    expect(await rows("mandates", "trip_id", trip.tripId)).toEqual([]);
  });

  it("the approval card payload validates against the shared schema", async () => {
    const trip = await decidedTrip();
    const { ctx } = await toolCall(trip);
    const note = "Timed entry; arrive by 10:00.";
    const { mandateId, cardMessageId } = await createMandate({ ctx, itemId: trip.itemId, optionId: trip.optionId, capPercent: 110, note });

    const [message] = await rows("messages", "id", cardMessageId);
    expect(message).toMatchObject({ kind: "card", card_type: "approval", sender_type: "agent", agent_run_id: trip.runId });
    const parsed = ApprovalCard.safeParse(message!.card_payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      mandate_id: mandateId,
      item_id: trip.itemId,
      title: "Georgia Aquarium · 4 tickets",
      merchant: "Demo Tickets (mock merchant)",
      quote_cents: 16800,
      cap_cents: 19200,
      currency: "usd",
      note,
    });
  });
});
