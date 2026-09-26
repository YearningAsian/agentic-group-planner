import { ToolName } from "@agp/shared";
import { describe, expect, it } from "vitest";
import { renderContext, type TripSnapshot } from "./context";
import { AGENT_INSTRUCTIONS, TOOL_GUIDE } from "./prompt";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const snapshot: TripSnapshot = {
  trip: { id: uuid(100), title: "Saturday in Atlanta", city: "Atlanta", trip_date: "2026-10-03", timezone: "America/New_York" },
  members: [1, 2, 3, 4].map((n) => ({
    id: uuid(n),
    display_name: `Person ${n}`,
    role: n === 1 ? ("organizer" as const) : ("member" as const),
    status: n === 4 ? ("placeholder" as const) : ("joined" as const),
    sort_order: n,
    budget_cents: 8000,
    dietary: n === 2 ? ["vegetarian"] : [],
    interests: [],
  })),
  items: [
    { id: uuid(14), slot_key: "dinner", label: "Dinner", starts_at: "2026-10-03T23:00:00Z", ends_at: "2026-10-04T00:30:00Z", position: 1, status: "tbd", chosen_option_id: null, area_label: "Midtown" },
  ],
  options: [],
  messages: [],
};

describe("the agent's system prompt", () => {
  it("the system prompt lists the 5 tools, says to use handles only, and forbids stating charged amounts", () => {
    expect(Object.keys(TOOL_GUIDE).sort()).toEqual([...ToolName.options].sort());
    for (const tool of ToolName.options) expect(AGENT_INSTRUCTIONS).toContain(`${tool}:`);
    expect(AGENT_INSTRUCTIONS).toMatch(/only by the handles/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/never state a price, time, score, or charged amount/i);
    // The model proposes; people pay (design §2.1, human in the loop).
    expect(AGENT_INSTRUCTIONS).toMatch(/you propose; people decide/i);
  });

  it("it includes the trip date, the requester's handle, and the TBD dinner", () => {
    const { system } = renderContext(snapshot, uuid(2));
    expect(system).toContain("Saturday, October 3, 2026");
    expect(system).toContain("This request is from M2 (Person 2).");
    expect(system).toContain("I1 Dinner 19:00–20:30 · tbd · area Midtown");
  });
});
