import "server-only";
import {
  formatUsd,
  type HoldKind,
  type ItemStatus,
  type MemberRole,
  type MemberStatus,
  SummarizeInput,
  SummaryCard,
  type SummaryMemberShare,
  type SummaryScope,
  type SummaryShareStatus,
  shareStatus,
} from "@agp/shared";
import type { Json } from "@agp/shared/db";
import { resolveHandle } from "@/lib/agent/handles";
import { AppError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import { defineTool } from "../define-tool";

/** Everything a summary is built from; `loadSummaryRows` reads it with the admin client. */
export interface SummaryRows {
  trip: { timezone: string };
  members: { id: string; display_name: string; role: MemberRole; status: MemberStatus; sort_order: number }[];
  /** Open items only (not superseded or cancelled). */
  items: {
    id: string;
    slot_key: string;
    label: string;
    starts_at: string;
    ends_at: string;
    status: ItemStatus;
    chosen_option_id: string | null;
    area_label: string | null;
  }[];
  attendees: { item_id: string; member_id: string }[];
  /** The place name behind each chosen option. */
  places: { option_id: string; name: string }[];
  /** Share rows on each item's live or captured mandate. */
  shares: { item_id: string; share_member_id: string; kind: HoldKind; status: string; share_cents: number; cap_cents: number }[];
}

export interface SummaryRequest {
  scope: SummaryScope;
  /** Whose schedule, for `personal` and `next_stop`. */
  memberId: string | null;
  now: Date;
}

const OPEN_STATUSES: ItemStatus[] = ["tbd", "proposing", "voting"];
const COMMITTED: SummaryShareStatus[] = ["paid", "authorized", "fronted"];
/** Across several shares, the least settled status wins: a member with anything to approve reads pending. */
const PRECEDENCE: SummaryShareStatus[] = ["pending", "awaiting_member", "fronted", "authorized", "paid"];
const MAX_LOGISTICS = 5;

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** "Person 2", "Person 2 and Person 3", or "Person 2, Person 3, Person 5, and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
}

/**
 * The summary card and the facts the model phrases its reply from (design §2.1). Pure and
 * deterministic: every time, count, and amount comes from the rows, never from the model.
 */
export function buildSummary(rows: SummaryRows, request: SummaryRequest): { card: SummaryCard; facts: string } {
  const { scope, memberId, now } = request;
  const tz = rows.trip.timezone;
  const members = [...rows.members].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1));
  const order = new Map(members.map((m, i) => [m.id, i]));
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const places = new Map(rows.places.map((p) => [p.option_id, p.name]));
  const attendeesOf = (itemId: string) =>
    rows.attendees
      .filter((a) => a.item_id === itemId)
      .map((a) => a.member_id)
      .sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));

  const items = [...rows.items].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : 1));
  const attending = memberId ? items.filter((item) => attendeesOf(item.id).includes(memberId)) : [];
  let inScope: typeof items;
  if (scope === "full") inScope = items;
  else if (scope === "personal") inScope = attending;
  else {
    const next = (attending.length > 0 ? attending : items).find((item) => Date.parse(item.ends_at) > now.getTime());
    inScope = next ? [next] : [];
  }

  // Money: each member's share on each item, then one status per member.
  const scopeMembers =
    scope === "full"
      ? members.map((m) => m.id)
      : scope === "personal"
        ? memberId
          ? [memberId]
          : []
        : inScope.flatMap((item) => attendeesOf(item.id));
  let committed = 0;
  let total = 0;
  const perMember: SummaryMemberShare[] = scopeMembers.map((member) => {
    const views = inScope
      .map((item) => shareStatus(rows.shares.filter((s) => s.item_id === item.id && s.share_member_id === member)))
      .filter((view) => view.status !== "none");
    const shareCents = views.reduce((sum, view) => sum + (view.share_cents ?? 0), 0);
    total += shareCents;
    committed += views.filter((v) => COMMITTED.includes(v.status)).reduce((sum, view) => sum + (view.share_cents ?? 0), 0);
    const status = PRECEDENCE.find((s) => views.some((v) => v.status === s)) ?? "none";
    return { member_id: member, share_cents: shareCents, status };
  });

  const open = inScope.filter((item) => OPEN_STATUSES.includes(item.status));
  const where = (item: (typeof items)[number]) => {
    const place = item.chosen_option_id ? places.get(item.chosen_option_id) : undefined;
    if (place) return place;
    return item.area_label ? `a place to be decided in ${item.area_label}` : "a place to be decided";
  };

  // Logistics: at most five lines, most useful first.
  const logistics: string[] = [];
  if (inScope.length === 0) {
    logistics.push(scope === "next_stop" ? "Nothing else is planned today." : "Nothing is planned yet.");
  } else if (scope === "next_stop") {
    const stop = inScope[0]!;
    logistics.push(`Next: ${stop.label} ${clock(stop.starts_at, tz)}–${clock(stop.ends_at, tz)} at ${where(stop)}.`);
  } else {
    const first = inScope[0]!;
    const last = inScope.reduce((a, b) => (Date.parse(b.ends_at) > Date.parse(a.ends_at) ? b : a));
    logistics.push(`Starts at ${clock(first.starts_at, tz)} with ${first.label} at ${where(first)}; ends at ${clock(last.ends_at, tz)}.`);
  }
  const bySlot = new Map<string, number>();
  for (const item of inScope) bySlot.set(item.slot_key, (bySlot.get(item.slot_key) ?? 0) + 1);
  const splits = inScope.filter((item, i) => (bySlot.get(item.slot_key) ?? 0) > 1 && inScope.findIndex((x) => x.slot_key === item.slot_key) === i);
  if (splits.length > 0) {
    const labels = splits.map((item) => item.label);
    logistics.push(`${nameList(labels)} ${labels.length === 1 ? "splits" : "split"} into groups.`);
  }
  if (open.length > 0) logistics.push(`Still to decide: ${nameList([...new Set(open.map((item) => item.label))])}.`);
  const named = (status: SummaryShareStatus) =>
    perMember.filter((m) => m.status === status).map((m) => names.get(m.member_id) ?? "A member");
  const approving = named("pending");
  if (approving.length > 0) logistics.push(`Waiting on approval from ${nameList(approving)}.`);
  const fronted = named("fronted");
  if (fronted.length > 0) {
    const organizer = members.find((m) => m.role === "organizer")?.display_name ?? "The organizer";
    logistics.push(
      fronted.length === 1
        ? `${organizer} is fronting ${fronted[0]}'s share until they pay.`
        : `${organizer} is fronting shares for ${nameList(fronted)} until they pay.`,
    );
  }
  const waiting = named("awaiting_member");
  if (waiting.length > 0) {
    logistics.push(
      waiting.length === 1
        ? `${waiting[0]} hasn't joined yet; their share waits for them.`
        : `${nameList(waiting)} haven't joined yet; their shares wait for them.`,
    );
  }

  const card: SummaryCard = {
    card_type: "summary",
    scope,
    ...(scope !== "full" && memberId ? { member_id: memberId } : {}),
    timeline: inScope.map((item) => ({
      item_id: item.id,
      starts_at: item.starts_at,
      label: item.label,
      place_name: item.chosen_option_id ? (places.get(item.chosen_option_id) ?? null) : null,
      attendee_ids: attendeesOf(item.id),
    })),
    money: { committed_cents: committed, per_member: perMember },
    open_items: open.map((item) => ({ item_id: item.id, label: item.label, status: item.status })),
    logistics: logistics.slice(0, MAX_LOGISTICS).map((line) => (line.length > 200 ? `${line.slice(0, 199)}…` : line)),
  };

  const whose = scope === "full" ? "the whole day" : scope === "personal" ? `${names.get(memberId ?? "") ?? "a member"}'s day` : "the next stop";
  const money = total > 0 ? `${formatUsd(committed)} committed of ${formatUsd(total)} in shares.` : "No money committed yet.";
  const facts = [
    `Posted a summary card for ${whose}: ${inScope.length} ${inScope.length === 1 ? "item" : "items"}, ${open.length} still open.`,
    money,
    ...card.logistics,
  ].join(" ");
  return { card, facts: facts.length > 600 ? `${facts.slice(0, 599)}…` : facts };
}

const LIVE_MANDATE = ["open", "partially_declined", "authorized", "captured"];

/** Reads what `buildSummary` needs for one trip with the admin client. */
export async function loadSummaryRows(admin: AdminClient, tripId: string): Promise<SummaryRows> {
  const fail = (what: string, cause: unknown) => new AppError("internal", `Couldn't read the trip's ${what}.`, { retryable: true, cause });

  const [trip, members, items, attendees, mandates] = await Promise.all([
    admin.from("trips").select("timezone").eq("id", tripId).single(),
    admin.from("trip_members").select("id, display_name, role, status, sort_order").eq("trip_id", tripId),
    admin
      .from("itinerary_items")
      .select("id, slot_key, label, starts_at, ends_at, status, chosen_option_id, area_label")
      .eq("trip_id", tripId)
      .not("status", "in", "(superseded,cancelled)"),
    admin.from("item_attendees").select("item_id, member_id").eq("trip_id", tripId),
    admin.from("mandates").select("id, item_id").eq("trip_id", tripId).in("status", LIVE_MANDATE),
  ]);
  if (trip.error) throw fail("details", trip.error);
  if (members.error) throw fail("members", members.error);
  if (items.error) throw fail("itinerary", items.error);
  if (attendees.error) throw fail("attendees", attendees.error);
  if (mandates.error) throw fail("payments", mandates.error);

  const chosen = items.data.flatMap((i) => (i.chosen_option_id ? [i.chosen_option_id] : []));
  const mandateItem = new Map(mandates.data.map((m) => [m.id, m.item_id]));
  const [options, holds] = await Promise.all([
    chosen.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin.from("item_options").select("id, place:places(name)").in("id", chosen),
    mandateItem.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("payment_holds")
          .select("mandate_id, share_member_id, kind, status, share_cents, cap_cents")
          .in("mandate_id", [...mandateItem.keys()]),
  ]);
  if (options.error) throw fail("places", options.error);
  if (holds.error) throw fail("payments", holds.error);

  return {
    trip: trip.data,
    members: members.data.map((m) => ({ ...m, role: m.role as MemberRole, status: m.status as MemberStatus })),
    items: items.data.map((i) => ({ ...i, status: i.status as ItemStatus })),
    attendees: attendees.data,
    places: options.data.flatMap((o) => (o.place ? [{ option_id: o.id, name: o.place.name }] : [])),
    shares: holds.data.map((h) => ({
      item_id: mandateItem.get(h.mandate_id)!,
      share_member_id: h.share_member_id,
      kind: h.kind as HoldKind,
      status: h.status,
      share_cents: h.share_cents,
      cap_cents: h.cap_cents,
    })),
  };
}

export function createSummarizeTool(deps: { now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  return defineTool({
    name: "summarize",
    description:
      "Summarize the plan for the whole group, for one member, or for the next stop, including the money committed so far. The server computes every number.",
    input: SummarizeInput,
    handler: async (input, ctx) => {
      const memberId = input.member_handle ? resolveHandle(ctx.handles, input.member_handle, "M") : ctx.requesterMemberId;
      if (input.scope === "personal" && !memberId) {
        throw new AppError("invalid_input", "Say whose schedule to summarize with member_handle.");
      }
      const rows = await loadSummaryRows(ctx.admin, ctx.tripId);
      if (memberId && !rows.members.some((m) => m.id === memberId)) {
        throw new AppError("unknown_handle", "That member isn't on this trip. Use a handle from the trip context.");
      }
      const { card, facts } = buildSummary(rows, { scope: input.scope, memberId, now: now() });

      const { data, error } = await ctx.admin
        .from("messages")
        .insert({
          trip_id: ctx.tripId,
          sender_type: "agent",
          kind: "card",
          card_type: "summary",
          card_payload: SummaryCard.parse(card) as unknown as Json,
          agent_run_id: ctx.runId,
        })
        .select("id")
        .single();
      if (error) throw new AppError("internal", "Couldn't post the summary.", { retryable: true, cause: error });
      return { ok: true, summary: facts, card_message_id: data.id };
    },
  });
}

export const summarizeTool = createSummarizeTool();
