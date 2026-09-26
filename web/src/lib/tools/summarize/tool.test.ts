import { SummarizeInput, SummaryCard } from "@agp/shared";
import { describe, expect, it } from "vitest";
import { buildSummary, type SummaryRows } from "./tool";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [p1, p2, p3, p4] = [1, 2, 3, 4].map(id);
const [morning, lunch, afternoonA, afternoonB, evening] = [11, 12, 13, 14, 15].map(id);
const aquarium = id(21);

function rows(overrides: Partial<SummaryRows> = {}): SummaryRows {
  return {
    trip: { timezone: "America/New_York" },
    members: [
      { id: p1, display_name: "Person 1", role: "organizer", status: "joined", sort_order: 1 },
      { id: p2, display_name: "Person 2", role: "member", status: "joined", sort_order: 2 },
      { id: p3, display_name: "Person 3", role: "member", status: "joined", sort_order: 3 },
      { id: p4, display_name: "Person 4", role: "member", status: "placeholder", sort_order: 4 },
    ],
    items: [
      { id: evening, slot_key: "evening", label: "Evening", starts_at: "2026-10-03T23:00:00Z", ends_at: "2026-10-04T01:00:00Z", status: "voting", chosen_option_id: null, area_label: null },
      { id: morning, slot_key: "morning", label: "Morning", starts_at: "2026-10-03T14:00:00Z", ends_at: "2026-10-03T16:30:00Z", status: "decided", chosen_option_id: aquarium, area_label: null },
      { id: lunch, slot_key: "lunch", label: "Lunch", starts_at: "2026-10-03T16:45:00Z", ends_at: "2026-10-03T17:45:00Z", status: "proposing", chosen_option_id: null, area_label: "Midtown" },
      { id: afternoonA, slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:00:00Z", ends_at: "2026-10-03T21:00:00Z", status: "tbd", chosen_option_id: null, area_label: null },
      { id: afternoonB, slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:00:00Z", ends_at: "2026-10-03T21:00:00Z", status: "tbd", chosen_option_id: null, area_label: null },
    ],
    attendees: [
      ...[p1, p2, p3, p4].flatMap((m) => [morning, lunch, evening].map((item_id) => ({ item_id, member_id: m }))),
      { item_id: afternoonA, member_id: p1 },
      { item_id: afternoonA, member_id: p2 },
      { item_id: afternoonB, member_id: p3 },
      { item_id: afternoonB, member_id: p4 },
    ],
    places: [{ option_id: aquarium, name: "Georgia Aquarium" }],
    // The morning's tickets: $42 each, capped at $48.
    shares: [
      { item_id: morning, share_member_id: p1, kind: "own", status: "authorized", share_cents: 4200, cap_cents: 4800 },
      { item_id: morning, share_member_id: p2, kind: "own", status: "pending", share_cents: 4200, cap_cents: 4800 },
      { item_id: morning, share_member_id: p3, kind: "own", status: "captured", share_cents: 4200, cap_cents: 4800 },
      { item_id: morning, share_member_id: p4, kind: "own", status: "awaiting_member", share_cents: 4200, cap_cents: 4800 },
      { item_id: morning, share_member_id: p4, kind: "fronted", status: "authorized", share_cents: 4200, cap_cents: 4800 },
    ],
    ...overrides,
  };
}

const now = new Date("2026-10-03T12:00:00Z");
const statusOf = (card: SummaryCard, member: string) => card.money.per_member.find((m) => m.member_id === member)?.status;

describe("buildSummary", () => {
  it("every number is computed on the server", () => {
    // The model names a scope and a member; any amount it sends is dropped.
    expect(Object.keys(SummarizeInput.shape)).toEqual(["scope", "member_handle"]);
    expect(SummarizeInput.parse({ scope: "full", committed_cents: 1, logistics: ["free tickets"] })).toEqual({ scope: "full" });

    const { card, facts } = buildSummary(rows(), { scope: "full", memberId: p2, now });

    expect(SummaryCard.parse(card)).toEqual(card);
    // Person 1 approved, Person 3 paid, and Person 4's share is fronted: 3 × $42.
    expect(card.money.committed_cents).toBe(12_600);
    expect(card.money.per_member).toEqual([
      { member_id: p1, share_cents: 4200, status: "authorized" },
      { member_id: p2, share_cents: 4200, status: "pending" },
      { member_id: p3, share_cents: 4200, status: "paid" },
      { member_id: p4, share_cents: 4200, status: "fronted" },
    ]);
    expect(card.timeline.map((t) => [t.label, t.place_name])).toEqual([
      ["Morning", "Georgia Aquarium"],
      ["Lunch", null],
      ["Afternoon", null],
      ["Afternoon", null],
      ["Evening", null],
    ]);
    expect(card.open_items.map((i) => i.item_id)).toEqual([lunch, afternoonA, afternoonB, evening]);
    // The facts the model phrases carry only the server's amounts and times.
    expect(facts).toContain("$126 committed");
    expect(facts.match(/\$\d+(\.\d\d)?/g)).toEqual(["$126", "$168"]);
    expect(facts.length).toBeLessThanOrEqual(600);
  });

  it("Person 4's share shows fronted until they pay", () => {
    // Before the organizer approves, Person 4's share waits for them.
    const unfronted = rows();
    unfronted.shares = unfronted.shares.map((s) => (s.kind === "fronted" ? { ...s, status: "pending" } : s));
    expect(statusOf(buildSummary(unfronted, { scope: "full", memberId: p1, now }).card, p4)).toBe("awaiting_member");

    const fronted = buildSummary(rows(), { scope: "personal", memberId: p4, now }).card;
    expect(fronted.member_id).toBe(p4);
    expect(fronted.money.per_member).toEqual([{ member_id: p4, share_cents: 4200, status: "fronted" }]);
    expect(fronted.logistics.join("\n")).toContain("fronting Person 4's share");

    const paid = rows();
    paid.shares = paid.shares.map((s) => (s.share_member_id === p4 ? { ...s, status: "captured" } : s));
    expect(statusOf(buildSummary(paid, { scope: "personal", memberId: p4, now }).card, p4)).toBe("paid");
  });

  it("logistics has 5 lines or fewer", () => {
    // Eight members, splits, open items, and approvals all want a line.
    const many = rows();
    const extra = [5, 6, 7, 8].map((n) => ({ id: id(n), display_name: `Person ${n}`, role: "member" as const, status: "placeholder" as const, sort_order: n }));
    many.members = [...many.members, ...extra];
    many.shares = [
      ...many.shares,
      ...extra.map((m) => ({ item_id: morning, share_member_id: m.id, kind: "own" as const, status: "pending", share_cents: 4200, cap_cents: 4800 })),
    ];

    const first = buildSummary(many, { scope: "full", memberId: p1, now }).card;
    expect(first.logistics.length).toBeGreaterThan(0);
    expect(first.logistics.length).toBeLessThanOrEqual(5);
    for (const line of first.logistics) expect(line.length).toBeLessThanOrEqual(200);
    // Deterministic: the same rows give the same lines.
    expect(buildSummary(many, { scope: "full", memberId: p1, now }).card.logistics).toEqual(first.logistics);
    expect(first.logistics[0]).toBe("Starts at 10:00 with Morning at Georgia Aquarium; ends at 21:00.");
  });

  it("next_stop is the member's first stop that hasn't ended", () => {
    const during = new Date("2026-10-03T17:00:00Z");
    const { card } = buildSummary(rows(), { scope: "next_stop", memberId: p3, now: during });
    expect(card.timeline.map((t) => t.item_id)).toEqual([lunch]);
    expect(card.open_items.map((i) => i.item_id)).toEqual([lunch]);

    const after = buildSummary(rows(), { scope: "next_stop", memberId: p3, now: new Date("2026-10-04T02:00:00Z") }).card;
    expect(after.timeline).toEqual([]);
    expect(after.logistics).toEqual(["Nothing else is planned today."]);
  });
});
