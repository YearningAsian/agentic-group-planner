import { describe, expect, it } from "vitest";
import { renderContext, type TripSnapshot } from "./context";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [p1, p2, p3, p4] = [uuid(1), uuid(2), uuid(3), uuid(4)];

function snapshot(overrides: Partial<TripSnapshot> = {}): TripSnapshot {
  const constraints = { budget_cents: 8000, interests: [] };
  return {
    trip: { id: uuid(100), title: "Saturday in Atlanta", city: "Atlanta", trip_date: "2026-10-03", timezone: "America/New_York" },
    members: [
      { id: p4, display_name: "Person 4", role: "member", status: "placeholder", sort_order: 4, ...constraints, dietary: [] },
      { id: p1, display_name: "Person 1", role: "organizer", status: "joined", sort_order: 1, ...constraints, dietary: [] },
      { id: p2, display_name: "Person 2", role: "member", status: "joined", sort_order: 2, ...constraints, dietary: ["vegetarian"] },
      { id: p3, display_name: "Person 3", role: "member", status: "joined", sort_order: 3, budget_cents: null, interests: [], dietary: [] },
    ],
    items: [
      {
        id: uuid(11),
        slot_key: "morning",
        label: "Morning",
        starts_at: "2026-10-03T14:00:00+00:00",
        ends_at: "2026-10-03T16:30:00+00:00",
        position: 1,
        status: "decided",
        chosen_option_id: uuid(21),
        area_label: null,
      },
      {
        id: uuid(14),
        slot_key: "dinner",
        label: "Dinner",
        starts_at: "2026-10-03T23:00:00+00:00",
        ends_at: "2026-10-04T00:30:00+00:00",
        position: 1,
        status: "tbd",
        chosen_option_id: null,
        area_label: "Midtown",
      },
    ],
    options: [
      { id: uuid(22), item_id: uuid(11), rank: 2, place_id: uuid(32), place_name: "High Museum of Art", price_cents: 1850 },
      { id: uuid(21), item_id: uuid(11), rank: 1, place_id: uuid(31), place_name: "Georgia Aquarium", price_cents: 4200 },
    ],
    messages: [],
    ...overrides,
  };
}

function message(n: number, sender: string | null, body: string, extra: Partial<TripSnapshot["messages"][number]> = {}) {
  return {
    id: uuid(1000 + n),
    created_at: new Date(Date.UTC(2026, 9, 1, 12, n)).toISOString(),
    sender_type: sender ? ("member" as const) : ("agent" as const),
    sender_member_id: sender,
    kind: "text" as const,
    body,
    card_type: null,
    item_id: null,
    ...extra,
  };
}

describe("renderContext", () => {
  it('renders members as "M1 Person 1 (organizer)" with budgets, and "M4 Person 4 (placeholder)"', () => {
    const { system, handles } = renderContext(snapshot(), p2);

    expect(system).toContain("Saturday in Atlanta");
    expect(system).toContain("M1 Person 1 (organizer) · budget $80");
    expect(system).toContain("M2 Person 2 (vegetarian) · budget $80");
    expect(system).toContain("M3 Person 3 · no budget set");
    expect(system).toContain("M4 Person 4 (placeholder) · budget $80");
    expect(system.indexOf("M1 Person 1")).toBeLessThan(system.indexOf("M4 Person 4"));
    expect(handles).toMatchObject({ M1: p1, M2: p2, M3: p3, M4: p4 });
  });

  it("lists what the planner remembers about a member, newest five, quoted", () => {
    const notes = ["a", "b", "hates early starts", "loves street food", "prefers museums", "walks slowly"];
    const members = snapshot().members.map((m) => (m.id === p2 ? { ...m, remembered: notes } : m));
    const { system } = renderContext(snapshot({ members }), p1);

    expect(system).toContain(
      'M2 Person 2 (vegetarian) · budget $80 · remembers "b"; "hates early starts"; "loves street food"; "prefers museums"; "walks slowly"',
    );
    expect(system).toContain("M1 Person 1 (organizer) · budget $80\n");
  });

  it("renders items in the trip's time zone, with status, the chosen place, and options", () => {
    const { system, handles } = renderContext(snapshot(), p1);

    expect(system).toContain("I1 Morning 10:00–12:30 · decided · Georgia Aquarium");
    expect(system).toContain("O1 Georgia Aquarium (P1) · $42 per person");
    expect(system).toContain("O2 High Museum of Art (P2) · $18.50 per person");
    expect(system).toContain("I2 Dinner 19:00–20:30 · tbd · area Midtown");
    expect(handles).toMatchObject({ I1: uuid(11), I2: uuid(14), O1: uuid(21), O2: uuid(22), P1: uuid(31), P2: uuid(32) });
  });

  it("includes the last 30 messages with sender names, and the requester's handle", () => {
    const messages = Array.from({ length: 35 }, (_, i) =>
      i % 2 === 0 ? message(i, p2, `member message ${i}`) : message(i, null, `agent reply ${i}`),
    );
    const { system, messages: rendered } = renderContext(snapshot({ messages }), p2);

    expect(rendered).toHaveLength(30);
    expect(rendered[0]).toEqual({ role: "assistant", content: "agent reply 5" });
    expect(rendered[1]).toEqual({ role: "user", content: "Person 2 (M2): member message 6" });
    expect(rendered.at(-1)).toEqual({ role: "user", content: "Person 2 (M2): member message 34" });
    expect(system).toContain("This request is from M2 (Person 2).");
  });

  it("marks item comments and cards so the model can tell them apart", () => {
    const messages = [
      message(1, p3, "can we do somewhere cheaper?", { item_id: uuid(11) }),
      message(2, null, "", { kind: "card", card_type: "plan", body: null }),
    ];
    const { messages: rendered } = renderContext(snapshot({ messages }), p1);

    expect(rendered).toEqual([
      { role: "user", content: "Person 3 (M3), commenting on I1: can we do somewhere cheaper?" },
      { role: "assistant", content: "[posted a plan card]" },
    ]);
  });

  it("a revision run quotes the whole comment thread of its item, even past the last 30 messages", () => {
    const thread = [
      message(1, p2, "Can we find somewhere cheaper for the morning?", { item_id: uuid(11) }),
      message(2, p3, "Anything under $20 works for me", { item_id: uuid(11) }),
    ];
    const later = Array.from({ length: 30 }, (_, i) => message(10 + i, p1, `chat ${i}`));
    const { system, messages } = renderContext(snapshot({ messages: [...thread, ...later], thread: { itemId: uuid(11), comments: thread } }), p2);

    expect(messages.map((m) => String(m.content)).join(" ")).not.toContain("cheaper");
    expect(system).toContain("This request is about I1 (Morning). Its comments, oldest first:");
    expect(system).toContain("- Person 2 (M2): Can we find somewhere cheaper for the morning?");
    expect(system).toContain("- Person 3 (M3): Anything under $20 works for me");
    expect(system).toContain("This request is from M2 (Person 2).");
  });

  it("the same snapshot renders the same context every time", () => {
    const first = renderContext(snapshot(), p1);
    const shuffled = snapshot();
    shuffled.members.reverse();
    shuffled.items.reverse();
    shuffled.options.reverse();
    expect(renderContext(shuffled, p1)).toEqual(first);
  });
});
