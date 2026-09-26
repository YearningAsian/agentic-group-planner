/**
 * `pnpm sandbox:smoke`: walks the sandbox happy path against the providers in web/.env.local.
 * Refuses live Stripe keys and non-test Duffel tokens (same rules as the env loader). The
 * optimizer on this machine is usually down, so the plan step feeds applyPlan a fixture answer
 * and reports that as mocked; payments, booking, webhooks, claim, settle, expiry, and recap use
 * the real app code on whatever PAYMENTS_PROVIDER / STAYS_PROVIDER the env selects.
 *
 * Run: `pnpm --filter web sandbox:smoke` (vitest smoke project: server-only stub + .env.local).
 * PAYMENTS_PROVIDER defaults to mock; set it to real with an sk_test_ key and the CLI's whsec_
 * secret in web/.env.local to exercise Stripe test mode. The script never writes credentials.
 */
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { components } from "@agp/shared/optimizer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPlan } from "@/features/itinerary/server";
import {
  approveHold,
  createMandate,
  expireMandates,
  finalizeMandate,
  settleFrontedShare,
} from "@/features/payments/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPaymentsProvider } from "@/lib/providers/payments";
import { summarizeTool } from "@/lib/tools/summarize/tool";
import { assignHandles } from "@/lib/agent/handles";
import { reset } from "./demo/reset";
import { claimPlaceholder, paymentsKit, shareRows, mandateRow, type PaymentsKit } from "../tests/payments/kit";
import { cleanup } from "../tests/db/helpers";
import { assertSandboxSmokeEnv } from "./sandbox-smoke-env";
import { frontingRefundProblems, type IntentView, payerIntentProblems } from "./sandbox-smoke-stripe";
import { STRIPE_OPTIONS } from "@/lib/providers/payments/real";

type PlanRequest = components["schemas"]["PlanRequest"];
type PlanResponse = components["schemas"]["PlanResponse"];

const BATCH = `smoke:${randomUUID().slice(0, 8)}`;

type StepMode = "real" | "mocked";

interface StepResult {
  name: string;
  ok: boolean;
  mode: StepMode;
  reason: string;
}

const results: StepResult[] = [];

function record(name: string, mode: StepMode, ok: boolean, reason: string): void {
  results.push({ name, mode, ok, reason });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name} (${mode}): ${reason}`);
}

/** Reads a PaymentIntent straight from Stripe; only real payments get here, so the key is a test key. */
async function intentView(paymentIntentId: string): Promise<IntentView> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, STRIPE_OPTIONS);
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return { id: pi.id, status: pi.status, amount: pi.amount, amountReceived: pi.amount_received, metadata: pi.metadata };
}

async function step(name: string, mode: StepMode, run: () => Promise<string>): Promise<void> {
  try {
    record(name, mode, true, await run());
  } catch (error) {
    record(name, mode, false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

describe("sandbox smoke", () => {
  let kit: PaymentsKit;
  let admin: ReturnType<typeof getAdminClient>;
  let tripId = "";
  let memberIds: string[] = [];
  let morningId = "";
  let optionId = "";
  let placeAquarium = "";
  let placeMuseum = "";
  let placePark = "";
  let runId = "";
  let mandateId = "";
  let person4UserId = "";

  beforeAll(() => {
    assertSandboxSmokeEnv(process.env);
    kit = paymentsKit();
    admin = getAdminClient();
    console.log(
      `sandbox:smoke batch=${BATCH} payments=${process.env.PAYMENTS_PROVIDER ?? "?"} llm=${process.env.LLM_PROVIDER ?? "?"} stays=${process.env.STAYS_PROVIDER ?? "?"}`,
    );
  });

  afterAll(async () => {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\nsandbox:smoke ${passed}/${results.length} steps passed`);
    for (const r of results) console.log(`  ${r.ok ? "ok" : "FAIL"}  ${r.name} [${r.mode}] — ${r.reason}`);
    await cleanup(BATCH);
  });

  it("runs the sandbox happy path", async () => {
    await step("reset and seed", "real", async () => {
      const probe = await admin.from("trips").select("id").limit(1);
      if (probe.error?.code === "PGRST205") {
        throw new Error(
          "public.trips is missing on this Supabase project. Link it (`supabase link --project-ref <ref>`) and run `supabase db push`, then re-run sandbox:smoke.",
        );
      }
      if (probe.error) throw new Error(`pre-reset trips probe: ${probe.error.message}`);
      const result = await reset({ batch: BATCH, admin: admin as never });
      tripId = result.seeded.tripId;
      const members = await admin.from("trip_members").select("id, display_name, sort_order, status").eq("trip_id", tripId).order("sort_order");
      if (members.error) throw members.error;
      memberIds = members.data.map((m) => m.id);
      const items = await admin.from("itinerary_items").select("id, slot_key").eq("trip_id", tripId);
      if (items.error) throw items.error;
      morningId = items.data.find((i) => i.slot_key === "morning")!.id;
      const places = await admin.from("places").select("id, provider_place_id").eq("provider", "seed").in("provider_place_id", ["georgia-aquarium", "high-museum", "piedmont-park"]);
      if (places.error) throw places.error;
      placeAquarium = places.data.find((p) => p.provider_place_id === "georgia-aquarium")!.id;
      placeMuseum = places.data.find((p) => p.provider_place_id === "high-museum")!.id;
      placePark = places.data.find((p) => p.provider_place_id === "piedmont-park")!.id;
      return `trip ${tripId.slice(0, 8)}… with ${memberIds.length} members`;
    });

    await step("Person 1 @agent plans the day", "mocked", async () => {
      // Local OPTIMIZER_URL is usually down; apply a fixture answer through the real apply_plan path.
      const run = await admin
        .from("agent_runs")
        .insert({
          trip_id: tripId,
          trigger: "mention",
          status: "running",
          provider: "mock",
          model: "muse-spark-1.3",
          requester_member_id: memberIds[0],
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (run.error) throw run.error;
      runId = run.data.id;
      const toolCallId = `call_${randomUUID()}`;
      const started = await admin.from("tool_calls").insert({
        trip_id: tripId,
        run_id: runId,
        tool_call_id: toolCallId,
        tool_name: "plan_day",
        input: { mode: "initial" },
        status: "started",
        seed_batch: BATCH,
      });
      if (started.error) throw started.error;

      const morning = await admin.from("itinerary_items").select("id, starts_at, ends_at").eq("id", morningId).single();
      if (morning.error) throw morning.error;
      const candidate = (placeId: string, price: number) => ({
        place_id: placeId,
        price_cents: price,
        tags: [],
        dietary_tags: [],
        duration_min: 90,
      });
      const option = (placeId: string, rank: number) => ({
        place_id: placeId,
        rank,
        score: 0.9 - rank / 10,
        preference: 0.8,
        cost: 0.4,
        travel: 0.2,
        fairness: 0.7,
      });
      const request: PlanRequest = {
        request_id: toolCallId,
        mode: "initial",
        members: memberIds.map((id) => ({ id, dietary: [], interests: [] })),
        slots: [
          {
            key: "morning",
            starts_at: morning.data.starts_at,
            ends_at: morning.data.ends_at,
            together: true,
            pinned: null,
            candidates: [candidate(placeAquarium, 4200), candidate(placeMuseum, 3000), candidate(placePark, 0)],
          },
        ],
        travel: [],
      };
      const response: PlanResponse = {
        request_id: toolCallId,
        engine: "enumeration",
        status: "feasible",
        solve_ms: 1,
        plans: [
          {
            rank: 1,
            total_score: 0.8,
            fairness: 0.7,
            split: false,
            member_scores: memberIds.map((id) => ({ member_id: id, score: 0.8, preference: 0.8, cost: 0.4, travel: 0.2 })),
            assignments: [{ slot_key: "morning", groups: [{ place_id: placeAquarium, member_ids: memberIds }] }],
          },
        ],
        slot_options: [
          {
            slot_key: "morning",
            groups: [{ member_ids: memberIds, options: [option(placeAquarium, 1), option(placeMuseum, 2), option(placePark, 3)] }],
          },
        ],
        infeasible_reasons: [],
      };

      const result = await applyPlan({
        tripId,
        actorMemberId: memberIds[0]!,
        runId,
        toolCallId,
        mode: "initial",
        request,
        response,
        itemsBySlot: { morning: morningId },
        reasoning: {},
      });
      await admin.from("agent_runs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", runId);
      return `morning voting with ${result.slots[0]?.groups[0]?.options.length ?? 0} options (optimizer fixture)`;
    });

    await step("organizer locks the morning option", "real", async () => {
      const opts = await admin.from("item_options").select("id, rank").eq("item_id", morningId).order("rank");
      if (opts.error) throw opts.error;
      optionId = opts.data[0]!.id;
      // voting → decided is the lock the pay flow needs (design §11.6).
      const decided = await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: optionId }).eq("id", morningId).eq("status", "voting");
      if (decided.error) throw decided.error;
      return `morning decided on option ${optionId.slice(0, 8)}…`;
    });

    await step("propose_purchase creates a mandate", "real", async () => {
      // Attach saved cards for Persons 1–3 the way the payments kit does.
      const profiles = await admin.from("trip_members").select("id, profile_id, sort_order").eq("trip_id", tripId).order("sort_order");
      if (profiles.error) throw profiles.error;
      for (const m of profiles.data.slice(0, 3)) {
        if (!m.profile_id) continue;
        const payments = getPaymentsProvider();
        const { customerId } = await payments.ensureCustomer({ profileId: m.profile_id, name: m.id });
        const { paymentMethodId } = await payments.attachTestCard({ customerId, card: "visa" });
        const updated = await admin.from("profiles").update({ stripe_customer_id: customerId, default_payment_method_id: paymentMethodId }).eq("id", m.profile_id);
        if (updated.error) throw updated.error;
      }

      const proposeRun = await admin
        .from("agent_runs")
        .insert({
          trip_id: tripId,
          trigger: "mention",
          status: "succeeded",
          finished_at: new Date().toISOString(),
          provider: "mock",
          model: "muse-spark-1.3",
          requester_member_id: memberIds[1],
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (proposeRun.error) throw proposeRun.error;
      const toolCallId = `call_${randomUUID()}`;
      const tool = await admin.from("tool_calls").insert({
        trip_id: tripId,
        run_id: proposeRun.data.id,
        tool_call_id: toolCallId,
        tool_name: "propose_purchase",
        input: { item_handle: "I1" },
        status: "started",
        seed_batch: BATCH,
      });
      if (tool.error) throw tool.error;
      const created = await createMandate({
        ctx: { tripId, runId: proposeRun.data.id, toolCallId, actorMemberId: memberIds[1]!, admin },
        itemId: morningId,
        optionId,
        idempotencyKey: `mandate:${proposeRun.data.id}:${toolCallId}`,
      });
      mandateId = created.mandateId;
      return `mandate ${mandateId.slice(0, 8)}… open`;
    });

    await step("Persons 1–3 approve; capture and booking", "real", async () => {
      for (const memberId of memberIds.slice(0, 3)) {
        await approveHold({ mandateId, memberId });
      }
      const finalized = await finalizeMandate(mandateId);
      expect(finalized).toEqual({ status: "captured" });
      const row = await mandateRow(mandateId);
      expect(row.status).toBe("captured");
      const { count } = await admin.from("bookings").select("*", { count: "exact", head: true }).eq("mandate_id", mandateId);
      expect(count).toBe(1);
      return `mandate captured with 1 booking`;
    });

    await step("Stripe holds and captures match the share rows", "real", async () => {
      if (!kit.stripe) return "skipped: mock payments";
      const members = await admin.from("trip_members").select("id, profile_id").in("id", memberIds.slice(0, 3));
      if (members.error) throw members.error;
      const profileOf = new Map(members.data.map((m) => [m.id, m.profile_id!]));
      const rows = [...(await shareRows(mandateId)).values()];
      const payers = [];
      for (const memberId of memberIds.slice(0, 3)) {
        const listed = await kit.stripe.intentsFor(profileOf.get(memberId)!, mandateId);
        payers.push({
          memberId,
          intents: await Promise.all(listed.map((intent) => intentView(intent.id))),
          rows: rows.filter((row) => row.payer_member_id === memberId),
        });
      }
      // Approving again after the capture must not create another hold.
      await approveHold({ mandateId, memberId: memberIds[1]! });
      const again = await kit.stripe.intentsFor(profileOf.get(memberIds[1]!)!, mandateId);
      const problems = [
        ...payerIntentProblems({ tripId, mandateId, payers }),
        ...(again.length === 1 ? [] : [`a repeated approval left ${again.length} PaymentIntents`]),
      ];
      expect(problems).toEqual([]);
      const organizer = payers[0]!.intents[0]!;
      return `3 PaymentIntents with mandate, payer, and trip metadata; organizer held ${organizer.amount}¢ and received ${organizer.amountReceived}¢; a repeat approval added none`;
    });

    await step("webhook confirms captures", "real", async () => {
      const rows = await shareRows(mandateId);
      const intentIds = new Set([...rows.values()].map((row) => row.stripe_payment_intent_id).filter((id): id is string => !!id));
      const deliveredIds: string[] = [];
      for (const intentId of intentIds) {
        for (const event of (await kit.eventsFor(intentId)).filter((e) => e.type === "payment_intent.succeeded")) {
          const response = await kit.deliver(event);
          expect(response.status).toBe(200);
          deliveredIds.push(event.id);
        }
      }
      expect(deliveredIds.length).toBeGreaterThan(0);
      const ledger = await admin
        .from("webhook_events")
        .select("event_id, status, attempts")
        .eq("provider", "stripe")
        .in("event_id", deliveredIds);
      if (ledger.error) throw ledger.error;
      expect(ledger.data).toHaveLength(deliveredIds.length);
      expect(ledger.data.every((event) => event.status === "processed" && event.attempts === 1)).toBe(true);
      return `delivered ${deliveredIds.length} payment_intent.succeeded event(s); all processed once`;
    });

    await step("Person 4 claims and cover refund settles once", "real", async () => {
      const person4 = await kit.createPayer(BATCH, "Person 4");
      person4UserId = person4.userId;
      await claimPlaceholder({ person: memberIds as [string, string, string, string] }, person4);
      // Person 4 authorizes their own share; settle refunds the organizer's fronted hold.
      await approveHold({ mandateId, memberId: memberIds[3]! }, { settle: async () => {} });
      const settled = await settleFrontedShare({ mandateId, memberId: memberIds[3]! });
      expect(settled.refundedCents).toBeGreaterThan(0);
      const again = await settleFrontedShare({ mandateId, memberId: memberIds[3]! });
      expect(again.refundedCents).toBe(0);
      if (!kit.stripe) return `refunded ${settled.refundedCents}¢ once; second settle is a no-op`;
      // Stripe's side (CO-304): Person 4's own capture, and one partial refund on the organizer's hold.
      const rows = await shareRows(mandateId);
      const [person4Intent, ...extra] = await kit.stripe.intentsFor(person4UserId, mandateId);
      expect(extra).toEqual([]);
      const organizerPi = rows.get(`${memberIds[0]}:own`)!.stripe_payment_intent_id!;
      const problems = frontingRefundProblems({
        person4Intent: await intentView(person4Intent!.id),
        own: rows.get(`${memberIds[3]}:own`)!,
        fronted: rows.get(`${memberIds[3]}:fronted`)!,
        organizerRefunds: (await kit.stripe.refundsFor(organizerPi)).map((refund) => refund.amountCents),
      });
      expect(problems).toEqual([]);
      return `refunded ${settled.refundedCents}¢ once on Stripe; Person 4 captured ${person4Intent!.amountReceivedCents}¢; second settle is a no-op`;
    });

    await step("replan after booking time change", "mocked", async () => {
      const booking = await admin.from("bookings").select("id, details").eq("mandate_id", mandateId).single();
      if (booking.error) throw booking.error;
      const morning = await admin.from("itinerary_items").select("starts_at, ends_at").eq("id", morningId).single();
      if (morning.error) throw morning.error;
      // Confirm the booking 45 minutes later than the slot; a later open slot should shift.
      const confirmed = new Date(Date.parse(morning.data.starts_at) + 45 * 60_000).toISOString();
      const details = { ...(booking.data.details as Record<string, unknown>), starts_at: confirmed };
      const updated = await admin.from("bookings").update({ details }).eq("id", booking.data.id);
      if (updated.error) throw updated.error;

      const afternoon = await admin.from("itinerary_items").select("id, starts_at, ends_at, status").eq("trip_id", tripId).eq("slot_key", "afternoon").maybeSingle();
      // Seed may not have an afternoon voting item with options; shift a dessert/tbd if present.
      const open = await admin
        .from("itinerary_items")
        .select("id, slot_key, starts_at, ends_at, status")
        .eq("trip_id", tripId)
        .in("status", ["tbd", "proposing", "voting"])
        .neq("id", morningId)
        .order("starts_at")
        .limit(1)
        .maybeSingle();
      if (open.error) throw open.error;
      if (!open.data) return "no open slot to shift (morning booked only) — skipped shift assert";

      const before = open.data.starts_at;
      const replanRun = await admin
        .from("agent_runs")
        .insert({
          trip_id: tripId,
          trigger: "mention",
          status: "running",
          provider: "mock",
          model: "muse-spark-1.3",
          requester_member_id: memberIds[0],
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (replanRun.error) throw replanRun.error;
      const toolCallId = `call_${randomUUID()}`;
      await admin.from("tool_calls").insert({
        trip_id: tripId,
        run_id: replanRun.data.id,
        tool_call_id: toolCallId,
        tool_name: "plan_day",
        input: { mode: "replan" },
        status: "started",
        seed_batch: BATCH,
      });

      // Time-shift only: plan a throwaway tbd with the same options shape, plus the shift map.
      const shiftTo = {
        starts_at: new Date(Date.parse(open.data.starts_at) + 45 * 60_000).toISOString(),
        ends_at: new Date(Date.parse(open.data.ends_at) + 45 * 60_000).toISOString(),
        delta_min: 45,
      };
      const request: PlanRequest = {
        request_id: toolCallId,
        mode: "replan",
        members: memberIds.map((id) => ({ id, dietary: [], interests: [] })),
        slots: [
          {
            key: open.data.slot_key,
            starts_at: open.data.starts_at,
            ends_at: open.data.ends_at,
            together: true,
            pinned: null,
            candidates: [
              { place_id: placeMuseum, price_cents: 3000, tags: [], dietary_tags: [], duration_min: 90 },
              { place_id: placePark, price_cents: 0, tags: [], dietary_tags: [], duration_min: 90 },
            ],
          },
        ],
        travel: [],
      };
      const response: PlanResponse = {
        request_id: toolCallId,
        engine: "enumeration",
        status: "feasible",
        solve_ms: 1,
        plans: [
          {
            rank: 1,
            total_score: 0.7,
            fairness: 0.6,
            split: false,
            member_scores: memberIds.map((id) => ({ member_id: id, score: 0.7, preference: 0.7, cost: 0.3, travel: 0.2 })),
            assignments: [{ slot_key: open.data.slot_key, groups: [{ place_id: placeMuseum, member_ids: memberIds }] }],
          },
        ],
        slot_options: [
          {
            slot_key: open.data.slot_key,
            groups: [
              {
                member_ids: memberIds,
                options: [
                  { place_id: placeMuseum, rank: 1, score: 0.8, preference: 0.8, cost: 0.3, travel: 0.2, fairness: 0.6 },
                  { place_id: placePark, rank: 2, score: 0.7, preference: 0.7, cost: 0.2, travel: 0.2, fairness: 0.6 },
                ],
              },
            ],
          },
        ],
        infeasible_reasons: [],
      };
      await applyPlan({
        tripId,
        actorMemberId: memberIds[0]!,
        runId: replanRun.data.id,
        toolCallId,
        mode: "replan",
        request,
        response,
        itemsBySlot: { [open.data.slot_key]: open.data.id },
        reasoning: {},
        timeShifts: { [open.data.id]: shiftTo },
      });
      await admin.from("agent_runs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", replanRun.data.id);
      const after = await admin.from("itinerary_items").select("starts_at, shifted_min").eq("id", open.data.id).single();
      if (after.error) throw after.error;
      expect(Date.parse(after.data.starts_at)).toBe(Date.parse(shiftTo.starts_at));
      void afternoon;
      return `${open.data.slot_key} moved ${before.slice(11, 16)} → ${after.data.starts_at.slice(11, 16)} (shifted_min=${after.data.shifted_min})`;
    });

    await step("mandate expiry releases open holds", "real", async () => {
      // Seed a second open mandate and backdate its expiry, then run expireMandates.
      const item = await admin
        .from("itinerary_items")
        .insert({
          trip_id: tripId,
          slot_key: "smoke-expire",
          label: "Expire me",
          category: "activity",
          starts_at: "2026-09-26T20:00:00Z",
          ends_at: "2026-09-26T22:00:00Z",
          position: 1,
          status: "voting",
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (item.error) throw item.error;
      const opt = await admin
        .from("item_options")
        .insert({
          trip_id: tripId,
          item_id: item.data.id,
          place_id: placeMuseum,
          rank: 1,
          price_cents: 1000,
          score: 0.5,
          score_breakdown: {},
          source: "mock",
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (opt.error) throw opt.error;
      await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: opt.data.id }).eq("id", item.data.id);
      await admin.from("item_attendees").insert(memberIds.slice(0, 3).map((member_id) => ({ item_id: item.data.id, member_id, trip_id: tripId, seed_batch: BATCH })));
      const expireRun = await admin
        .from("agent_runs")
        .insert({
          trip_id: tripId,
          trigger: "mention",
          status: "succeeded",
          finished_at: new Date().toISOString(),
          provider: "mock",
          model: "m",
          requester_member_id: memberIds[0],
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (expireRun.error) throw expireRun.error;
      const toolCallId = `call_${randomUUID()}`;
      await admin.from("tool_calls").insert({
        trip_id: tripId,
        run_id: expireRun.data.id,
        tool_call_id: toolCallId,
        tool_name: "propose_purchase",
        input: {},
        status: "started",
        seed_batch: BATCH,
      });
      const { mandateId: openId } = await createMandate({
        ctx: { tripId, runId: expireRun.data.id, toolCallId, actorMemberId: memberIds[0]!, admin },
        itemId: item.data.id,
        optionId: opt.data.id,
        idempotencyKey: `mandate:${expireRun.data.id}:${toolCallId}`,
      });
      await approveHold({ mandateId: openId, memberId: memberIds[0]! }, { finalize: async () => {} });
      const past = new Date(Date.now() - 60_000).toISOString();
      const aged = await admin.from("mandates").update({ expires_at: past }).eq("id", openId);
      if (aged.error) throw aged.error;
      // expireMandates is trip-wide: refuse if anything else is already past expiry.
      const others = await admin.from("mandates").select("id").in("status", ["open", "partially_declined"]).lt("expires_at", new Date().toISOString()).neq("id", openId);
      if (others.error) throw others.error;
      if (others.data.length > 0) {
        throw new Error(`refusing expireMandates: ${others.data.length} other open mandate(s) are past expiry on this project`);
      }
      const { expired } = await expireMandates();
      expect(expired).toContain(openId);
      expect(await mandateRow(openId)).toMatchObject({ status: "cancelled", cancel_reason: "expired" });
      return `expired mandate ${openId.slice(0, 8)}… (cancelled with reason expired)`;
    });

    await step("recap summarize", "real", async () => {
      const members = await admin.from("trip_members").select("id, sort_order").eq("trip_id", tripId).order("sort_order");
      if (members.error) throw members.error;
      const items = await admin.from("itinerary_items").select("id, starts_at, position, slot_key").eq("trip_id", tripId);
      if (items.error) throw items.error;
      const options = await admin.from("item_options").select("id, item_id, rank, place_id").eq("trip_id", tripId);
      if (options.error) throw options.error;
      const handles = assignHandles({ members: members.data, items: items.data, options: options.data }).table;
      const recapRun = await admin
        .from("agent_runs")
        .insert({
          trip_id: tripId,
          trigger: "mention",
          status: "running",
          provider: "mock",
          model: "m",
          requester_member_id: memberIds[0],
          seed_batch: BATCH,
        })
        .select("id")
        .single();
      if (recapRun.error) throw recapRun.error;
      const result = await summarizeTool.handler(summarizeTool.input.parse({ scope: "full" }), {
        tripId,
        runId: recapRun.data.id,
        toolCallId: `call_${randomUUID()}`,
        requesterMemberId: memberIds[0]!,
        actorMemberId: memberIds[0]!,
        handles,
        admin,
      });
      expect(result.ok).toBe(true);
      await admin.from("agent_runs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", recapRun.data.id);
      return result.summary.slice(0, 120);
    });

    void person4UserId;
    const failed = results.filter((r) => !r.ok);
    expect(failed, failed.map((f) => f.name).join(", ")).toEqual([]);
  });
});
