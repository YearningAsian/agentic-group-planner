import "server-only";
import type { CardType, ItemStatus, MemberRole, MemberStatus, MessageKind, SenderType } from "@agp/shared";
import type { ModelMessage } from "ai";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { assignHandles, type HandleTable } from "./handles";
import { AGENT_INSTRUCTIONS } from "./prompt";

/** How much chat history the model sees (design §2.1). */
export const CONTEXT_MESSAGES = 30;

/** Everything the model's context is built from, read in one pass. Pure input to `renderContext`. */
export interface TripSnapshot {
  trip: { id: string; title: string; city: string; trip_date: string; timezone: string };
  members: {
    id: string;
    display_name: string;
    role: MemberRole;
    status: MemberStatus;
    sort_order: number;
    budget_cents: number | null;
    dietary: string[];
    interests: string[];
  }[];
  /** Open items only: superseded and cancelled items are history, not plan. */
  items: {
    id: string;
    slot_key: string;
    label: string;
    starts_at: string;
    ends_at: string;
    position: number;
    status: ItemStatus;
    chosen_option_id: string | null;
    area_label: string | null;
    /** Absent when not loaded; when it lists fewer than every member, the item is one side of a split. */
    attendee_ids?: string[];
  }[];
  options: { id: string; item_id: string; rank: number; place_id: string; place_name: string; price_cents: number }[];
  /** Oldest first. */
  messages: {
    id: string;
    created_at: string;
    sender_type: SenderType;
    sender_member_id: string | null;
    kind: MessageKind;
    body: string | null;
    card_type: CardType | string | null;
    item_id: string | null;
  }[];
}

export interface AgentContext {
  system: string;
  messages: ModelMessage[];
  handles: HandleTable;
}

/** Whole dollars when there are no cents, like "$80" or "$18.50". Integer math only. */
function usd(cents: number): string {
  const rest = cents % 100;
  return `$${Math.trunc(cents / 100)}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Builds the model's context from a snapshot (design §2.1): the trip, members with their handles and
 * budgets, the open itinerary with options and places, the last 30 messages with sender names, and
 * who asked. Deterministic: the same snapshot always renders the same context and handles.
 */
export function renderContext(snapshot: TripSnapshot, requesterMemberId: string | null): AgentContext {
  const { trip } = snapshot;
  const { table, byId } = assignHandles(snapshot);
  const handleOf = (id: string) => byId[id] ?? "?";

  const members = [...snapshot.members].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1));
  const memberLines = members.map((m) => {
    const tags = [
      ...(m.role === "organizer" ? ["organizer"] : []),
      ...(m.status === "joined" ? [] : [m.status]),
      ...m.dietary.map((d) => d.replaceAll("_", " ")),
    ];
    const budget = m.budget_cents === null ? "no budget set" : `budget ${usd(m.budget_cents)}`;
    const interests = m.interests.length > 0 ? ` · likes ${m.interests.join(", ")}` : "";
    return `${handleOf(m.id)} ${m.display_name}${tags.length > 0 ? ` (${tags.join(", ")})` : ""} · ${budget}${interests}`;
  });

  const items = [...snapshot.items].sort((a, b) => handleOf(a.id).localeCompare(handleOf(b.id), "en", { numeric: true }));
  const itemLines = items.flatMap((item) => {
    const options = snapshot.options
      .filter((o) => o.item_id === item.id)
      .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
    const chosen = options.find((o) => o.id === item.chosen_option_id);
    const split =
      item.attendee_ids && item.attendee_ids.length > 0 && item.attendee_ids.length < members.length
        ? ` · with ${item.attendee_ids.map(handleOf).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).join(", ")}`
        : "";
    const head = [
      `${handleOf(item.id)} ${item.label} ${clock(item.starts_at, trip.timezone)}–${clock(item.ends_at, trip.timezone)}`,
      item.status,
      ...(chosen ? [chosen.place_name] : []),
      ...(item.area_label ? [`area ${item.area_label}`] : []),
    ].join(" · ");
    return [
      `${head}${split}`,
      ...options.map((o) => `  ${handleOf(o.id)} ${o.place_name} (${handleOf(o.place_id)}) · ${usd(o.price_cents)} per person`),
    ];
  });

  const requester = members.find((m) => m.id === requesterMemberId);
  const system = [
    AGENT_INSTRUCTIONS,
    "",
    `Trip: ${trip.title} · ${trip.city} · ${longDate(trip.trip_date)}. Times are local (${trip.timezone}).`,
    "",
    "Members:",
    ...memberLines,
    "",
    "Itinerary:",
    ...(itemLines.length > 0 ? itemLines : ["(nothing planned yet)"]),
    "",
    requester
      ? `This request is from ${handleOf(requester.id)} (${requester.display_name}).`
      : "This run was started by the server, not by a member.",
  ].join("\n");

  const names = new Map(snapshot.members.map((m) => [m.id, m.display_name]));
  const messages = snapshot.messages.slice(-CONTEXT_MESSAGES).map((m): ModelMessage => {
    if (m.kind === "card") {
      const card = `${String(m.card_type).replaceAll("_", " ")} card`;
      return m.sender_type === "agent"
        ? { role: "assistant", content: `[posted a ${card}]` }
        : { role: "user", content: `[the app posted a ${card}]` };
    }
    if (m.sender_type === "agent") return { role: "assistant", content: m.body ?? "" };
    if (m.sender_type === "system") return { role: "user", content: `(app) ${m.body ?? ""}` };
    const sender = m.sender_member_id ? `${names.get(m.sender_member_id) ?? "A member"} (${handleOf(m.sender_member_id)})` : "A member";
    const on = m.item_id ? `, commenting on ${byId[m.item_id] ?? "an earlier item"}` : "";
    return { role: "user", content: `${sender}${on}: ${m.body ?? ""}` };
  });

  return { system, messages, handles: table };
}

/** Reads what `renderContext` needs for one trip with the admin client. */
export async function loadTripSnapshot(admin: AdminClient, tripId: string): Promise<TripSnapshot> {
  const fail = (what: string, cause: unknown) =>
    new AppError("internal", `Couldn't read the trip's ${what}.`, { retryable: true, cause });

  const [trip, members, constraints, items, attendees, messages] = await Promise.all([
    admin.from("trips").select("id, title, city, trip_date, timezone").eq("id", tripId).single(),
    admin.from("trip_members").select("id, display_name, role, status, sort_order").eq("trip_id", tripId),
    admin.from("member_constraints").select("member_id, budget_cents, dietary, interests").eq("trip_id", tripId),
    admin
      .from("itinerary_items")
      .select("id, slot_key, label, starts_at, ends_at, position, status, chosen_option_id, area_label")
      .eq("trip_id", tripId)
      .not("status", "in", "(superseded,cancelled)"),
    admin.from("item_attendees").select("item_id, member_id").eq("trip_id", tripId),
    admin
      .from("messages")
      .select("id, created_at, sender_type, sender_member_id, kind, body, card_type, item_id")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CONTEXT_MESSAGES),
  ]);
  if (trip.error) throw fail("details", trip.error);
  if (members.error) throw fail("members", members.error);
  if (constraints.error) throw fail("constraints", constraints.error);
  if (items.error) throw fail("itinerary", items.error);
  if (attendees.error) throw fail("attendees", attendees.error);
  if (messages.error) throw fail("messages", messages.error);

  const itemIds = items.data.map((i) => i.id);
  const options =
    itemIds.length === 0
      ? { data: [], error: null }
      : await admin
          .from("item_options")
          .select("id, item_id, rank, place_id, price_cents, place:places(name)")
          .eq("trip_id", tripId)
          .in("item_id", itemIds);
  if (options.error) throw fail("options", options.error);

  const constraintsByMember = new Map(constraints.data.map((c) => [c.member_id, c]));
  return {
    trip: trip.data,
    members: members.data.map((m) => {
      const c = constraintsByMember.get(m.id);
      return {
        ...m,
        role: m.role as MemberRole,
        status: m.status as MemberStatus,
        budget_cents: c?.budget_cents ?? null,
        dietary: c?.dietary ?? [],
        interests: c?.interests ?? [],
      };
    }),
    items: items.data.map((i) => ({
      ...i,
      status: i.status as ItemStatus,
      attendee_ids: attendees.data.filter((a) => a.item_id === i.id).map((a) => a.member_id),
    })),
    options: options.data.map(({ place, ...o }) => ({ ...o, place_name: place?.name ?? "Unknown place" })),
    messages: [...messages.data].reverse().map((m) => ({
      ...m,
      sender_type: m.sender_type as SenderType,
      kind: m.kind as MessageKind,
    })),
  };
}

/** The model's context for one run: `loadTripSnapshot`, then `renderContext`. */
export async function buildContext(
  tripId: string,
  requesterMemberId: string | null,
  admin: AdminClient = getAdminClient(),
): Promise<AgentContext> {
  return renderContext(await loadTripSnapshot(admin, tripId), requesterMemberId);
}
