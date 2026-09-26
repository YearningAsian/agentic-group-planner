import "server-only";
import { type ItemStatus, type itinerary, type ShareRow, shareStatus } from "@agp/shared";
import { AppError } from "@/lib/reliability";
import type { ServerClient } from "@/lib/supabase/server";

type ItineraryExport = itinerary.ItineraryExport;
type ItineraryStop = itinerary.ItineraryStop;

/** Everything one member's itinerary is built from; `loadItineraryRows` reads it through RLS. */
export interface ItineraryRows {
  trip: ItineraryExport["trip"];
  memberId: string;
  members: { id: string; display_name: string }[];
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
  /** The place behind each chosen option. */
  places: { option_id: string; place_id: string; name: string; address: string | null; lat: number; lng: number }[];
  /** The member's share rows on each item's live or captured mandate. */
  shares: (ShareRow & { item_id: string })[];
}

/**
 * The member's schedule (design §5.5): the items they attend, in time order, each with its place,
 * times, fellow attendees, and their payment status, plus their money totals. Pure.
 */
export function assembleItinerary(rows: ItineraryRows): ItineraryExport {
  const names = new Map(rows.members.map((m) => [m.id, m.display_name]));
  const attended = new Set(rows.attendees.filter((a) => a.member_id === rows.memberId).map((a) => a.item_id));
  const places = new Map(rows.places.map((p) => [p.option_id, p]));

  const stops: ItineraryStop[] = rows.items
    .filter((item) => attended.has(item.id))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : 1))
    .map((item) => {
      const place = item.chosen_option_id ? places.get(item.chosen_option_id) : undefined;
      return {
        item_id: item.id,
        slot_key: item.slot_key,
        label: item.label,
        starts_at: item.starts_at,
        ends_at: item.ends_at,
        status: item.status,
        place: place ? { place_id: place.place_id, name: place.name, address: place.address, lat: place.lat, lng: place.lng } : null,
        area_label: item.area_label,
        attendees: rows.attendees
          .filter((a) => a.item_id === item.id && a.member_id !== rows.memberId)
          .map((a) => ({ member_id: a.member_id, display_name: names.get(a.member_id) ?? "A member" }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name, "en", { numeric: true })),
        payment: shareStatus(rows.shares.filter((s) => s.item_id === item.id)),
      };
    });

  const committed = stops.filter((s) => ["paid", "authorized", "fronted"].includes(s.payment.status));
  const paid = stops.filter((s) => s.payment.status === "paid");
  const toApprove = stops.filter((s) => s.payment.status === "pending").length;
  const withMoney = stops.filter((s) => s.payment.status !== "none");
  const sum = (list: ItineraryStop[]) => list.reduce((total, s) => total + (s.payment.share_cents ?? 0), 0);
  return {
    trip: rows.trip,
    member: { member_id: rows.memberId, display_name: names.get(rows.memberId) ?? "A member" },
    stops,
    totals: {
      committed_cents: sum(committed),
      paid_cents: sum(paid),
      to_approve: toApprove,
      status: withMoney.length === 0 ? "none" : paid.length === withMoney.length ? "all_paid" : "in_progress",
    },
  };
}

/** RFC 5545 text: backslash, semicolon, comma, and newline escaped. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines of at most 75 octets, continued with CRLF and a space. Never splits a character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(current + char, "utf8") > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (iso: string | Date) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The itinerary as a calendar file: one VEVENT per attended item, times in UTC. */
export function toIcs(itinerary: ItineraryExport, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//agentic-group-planner//itinerary//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(`${itinerary.trip.title} · ${itinerary.member.display_name}`)}`,
  ];
  for (const stop of itinerary.stops) {
    const where = stop.place?.name ?? (stop.area_label ? `${stop.area_label} (to be decided)` : "to be decided");
    const with_ = stop.attendees.length > 0 ? `With ${stop.attendees.map((a) => a.display_name).join(", ")}. ` : "";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stop.item_id}@agentic-group-planner`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(stop.starts_at)}`,
      `DTEND:${stamp(stop.ends_at)}`,
      `SUMMARY:${text(`${stop.label} · ${where}`)}`,
      ...(stop.place ? [`LOCATION:${text([stop.place.name, stop.place.address].filter(Boolean).join(", "))}`] : []),
      ...(stop.place ? [`GEO:${stop.place.lat};${stop.place.lng}`] : []),
      `DESCRIPTION:${text(`${with_}Payment: ${stop.payment.label}.`)}`,
      `STATUS:${stop.status === "booked" || stop.status === "decided" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

const LIVE_MANDATE = ["open", "partially_declined", "authorized", "captured"];

/**
 * Reads one member's itinerary rows with the caller's session, so row-level security decides:
 * a caller who isn't a member of the trip sees no trip and gets `not_permitted`.
 */
export async function loadItineraryRows(client: ServerClient, tripId: string, member: "me" | string): Promise<ItineraryRows> {
  const fail = (what: string, cause: unknown) => new AppError("internal", `Couldn't read the ${what}.`, { retryable: true, cause });

  const trip = await client.from("trips").select("id, title, city, trip_date, timezone").eq("id", tripId).maybeSingle();
  if (trip.error) throw fail("trip", trip.error);
  if (!trip.data) throw new AppError("not_permitted", "You're not a member of this trip.");

  const members = await client.from("trip_members").select("id, display_name, profile_id").eq("trip_id", tripId);
  if (members.error) throw fail("members", members.error);
  let memberId = member;
  if (member === "me") {
    const { data: auth } = await client.auth.getUser();
    const me = members.data.find((m) => auth.user && m.profile_id === auth.user.id);
    if (!me) throw new AppError("not_permitted", "You're not a member of this trip.");
    memberId = me.id;
  } else if (!members.data.some((m) => m.id === member)) {
    throw new AppError("not_found", "That member isn't on this trip.");
  }

  const items = await client
    .from("itinerary_items")
    .select("id, slot_key, label, starts_at, ends_at, status, chosen_option_id, area_label")
    .eq("trip_id", tripId)
    .not("status", "in", "(superseded,cancelled)");
  if (items.error) throw fail("itinerary", items.error);
  const itemIds = items.data.map((i) => i.id);
  const chosen = items.data.flatMap((i) => (i.chosen_option_id ? [i.chosen_option_id] : []));

  const [attendees, options, mandates] = await Promise.all([
    client.from("item_attendees").select("item_id, member_id").eq("trip_id", tripId),
    chosen.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client.from("item_options").select("id, place:places(id, name, address, lat, lng)").in("id", chosen),
    itemIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client.from("mandates").select("id, item_id").eq("trip_id", tripId).in("status", LIVE_MANDATE),
  ]);
  if (attendees.error) throw fail("attendees", attendees.error);
  if (options.error) throw fail("places", options.error);
  if (mandates.error) throw fail("payments", mandates.error);

  const mandateItem = new Map(mandates.data.map((m) => [m.id, m.item_id]));
  const holds =
    mandateItem.size === 0
      ? { data: [], error: null }
      : await client
          .from("payment_holds")
          .select("mandate_id, kind, status, share_cents, cap_cents")
          .eq("share_member_id", memberId)
          .in("mandate_id", [...mandateItem.keys()]);
  if (holds.error) throw fail("payments", holds.error);

  return {
    trip: trip.data,
    memberId,
    members: members.data.map(({ id, display_name }) => ({ id, display_name })),
    items: items.data.map((i) => ({ ...i, status: i.status as ItemStatus })),
    attendees: attendees.data,
    places: options.data.flatMap((o) =>
      o.place ? [{ option_id: o.id, place_id: o.place.id, name: o.place.name, address: o.place.address, lat: o.place.lat, lng: o.place.lng }] : [],
    ),
    shares: holds.data.map((h) => ({
      item_id: mandateItem.get(h.mandate_id)!,
      kind: h.kind as ShareRow["kind"],
      status: h.status,
      share_cents: h.share_cents,
      cap_cents: h.cap_cents,
    })),
  };
}

/** One member's itinerary, read with the caller's session (design §5.5). */
export async function buildItineraryExport(
  client: ServerClient,
  input: { tripId: string; memberId: "me" | string },
): Promise<ItineraryExport> {
  return assembleItinerary(await loadItineraryRows(client, input.tripId, input.memberId));
}
