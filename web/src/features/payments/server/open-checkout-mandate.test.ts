import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingProvider } from "@/lib/providers/booking";
import { capFor } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import { openCheckoutMandate } from "./open-checkout-mandate";

const tripId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";
const organizerId = "55555555-5555-4555-8555-555555555555";
const guestId = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

function database(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {
    trips: [],
    trip_members: [],
    itinerary_items: [],
    item_options: [],
    item_attendees: [],
    mandates: [],
    payment_holds: [],
    ...seed,
  };
  function from(table: string) {
    const source = tables[table] ?? [];
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | undefined;
    let inserted: Row[] | undefined;
    const matches = () => (inserted ?? source).filter((row) => filters.every((filter) => filter(row)));
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
      insert(row: Row) {
        inserted = [{ ...row }];
        source.push(inserted[0]!);
        return builder;
      },
      upsert(rows: Row[]) {
        for (const row of rows) {
          if (!source.some((existing) => existing.idempotency_key === row.idempotency_key)) source.push({ ...row });
        }
        return builder;
      },
      update(values: Row) {
        patch = values;
        return builder;
      },
      async maybeSingle() {
        const rows = matches();
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        const rows = matches();
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve(resolve({ data: rows.map((row) => ({ ...row })), error: null }));
      },
    };
    return builder;
  }
  return { tables, admin: { from } as unknown as AdminClient };
}

const booking = {
  id: "mock_merchant",
  merchantName: "Demo Tickets (mock merchant)",
  needsGuest: false,
  async quote() {
    return { quoteId: "q_test", totalCents: 3000, currency: "usd", expiresAt: "2026-09-27T00:15:00.000Z" };
  },
  async book() {
    return { status: "confirmed" as const, providerRef: "mock_bk" };
  },
  async cancel() {
    return { status: "cancelled" as const };
  },
} as BookingProvider;

function seed() {
  return database({
    trips: [{ id: tripId, price_threshold_percent: 110, timezone: "America/New_York" }],
    trip_members: [{ id: organizerId, trip_id: tripId, role: "organizer", status: "joined", profile_id: profileId, display_name: "Ada", sort_order: 0 }],
    itinerary_items: [{ id: itemId, trip_id: tripId, status: "decided", starts_at: "2026-10-01T15:00:00Z", ends_at: "2026-10-01T18:00:00Z", category: "activity" }],
    item_options: [{ id: optionId, item_id: itemId, place_id: "place", price_cents: 1500, places: { name: "Aquarium", provider: "mock", raw: {} } }],
    item_attendees: [
      { item_id: itemId, trip_members: { id: organizerId, display_name: "Ada", status: "joined", sort_order: 0 } },
      { item_id: itemId, trip_members: { id: guestId, display_name: "Bea", status: "joined", sort_order: 1 } },
      { item_id: itemId, trip_members: { id: "placeholder", display_name: "Cam", status: "invited", sort_order: 2 } },
    ],
  });
}

const input = { tripId, itemId, optionId, profileId };

beforeEach(() => vi.restoreAllMocks());

describe("openCheckoutMandate", () => {
  it("inserts one open mandate and one pending hold per joined traveler", async () => {
    const db = seed();
    const result = await openCheckoutMandate(input, { admin: db.admin, booking, now: Date.parse("2026-09-27T00:00:00Z") });

    expect(db.tables.mandates).toHaveLength(1);
    expect(db.tables.mandates[0]).toMatchObject({
      trip_id: tripId,
      item_id: itemId,
      option_id: optionId,
      status: "open",
      idempotency_key: `group-checkout:${itemId}`,
      quote_cents: 3000,
      currency: "usd",
      merchant: "Demo Tickets (mock merchant)",
    });
    expect(db.tables.payment_holds).toEqual([
      expect.objectContaining({ share_member_id: organizerId, payer_member_id: organizerId, kind: "own", status: "pending", share_cents: 1500, cap_cents: capFor(1500, 110) }),
      expect.objectContaining({ share_member_id: guestId, payer_member_id: guestId, kind: "own", status: "pending", share_cents: 1500, cap_cents: capFor(1500, 110) }),
    ]);
    expect(result.holds.map((hold) => hold.memberId)).toEqual([organizerId, guestId]);
    expect(result.mandateId).toBe(db.tables.mandates[0]!.id);
  });

  it("rejects a missing trip before inserting a mandate", async () => {
    const db = seed();
    db.tables.trips = [];
    await expect(openCheckoutMandate(input, { admin: db.admin, booking })).rejects.toMatchObject({
      code: "invalid_input",
      message: "A saved trip with a decided option is required before checkout.",
    });
    expect(db.tables.mandates).toHaveLength(0);
    expect(db.tables.payment_holds).toHaveLength(0);
  });

  it("reuses a live mandate instead of inserting another", async () => {
    const db = seed();
    db.tables.mandates.push({ id: "mandate-live", item_id: itemId, status: "open", currency: "usd" });
    db.tables.payment_holds.push(
      { mandate_id: "mandate-live", share_member_id: organizerId, kind: "own", cap_cents: 2000, status: "authorized" },
      { mandate_id: "mandate-live", share_member_id: guestId, kind: "own", cap_cents: 2000, status: "pending" },
    );
    const result = await openCheckoutMandate(input, { admin: db.admin, booking });
    expect(db.tables.mandates).toHaveLength(1);
    expect(result.mandateId).toBe("mandate-live");
    expect(result.holds).toEqual([
      { memberId: organizerId, name: "Ada", capCents: 2000, status: "authorized" },
      { memberId: guestId, name: "Bea", capCents: 2000, status: "pending" },
    ]);
  });
});
