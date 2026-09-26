import { describe, expect, it } from "vitest";
import { HUMAN_IN_LOOP_LABEL, MONEY_CARD_TYPES, pairsAgentWithPaid } from "./human-in-loop";

describe("human-in-the-loop copy", () => {
  it("the label reads exactly 'Agent proposed · You approve'", () => {
    expect(HUMAN_IN_LOOP_LABEL).toBe("Agent proposed · You approve");
  });

  it("lists the card types that show money", () => {
    expect([...MONEY_CARD_TYPES].sort()).toEqual(["approval", "booking_confirmed", "plan", "price_change"]);
  });

  it.each([
    "The agent paid $42 for the tickets.",
    "Agent has paid",
    "agent pays the deposit",
    "Tickets paid by the agent",
    "Paid by agent",
  ])("flags the agent as the subject of paid: %s", (text) => {
    expect(pairsAgentWithPaid(text)).toBe(true);
  });

  it.each(["I paid for the tickets.", "I've paid the deposit", "We already paid"])(
    "flags first-person payment claims when the agent is speaking: %s",
    (text) => {
      expect(pairsAgentWithPaid(text, { speaker: "agent" })).toBe(true);
      expect(pairsAgentWithPaid(text)).toBe(false);
    },
  );

  it.each([
    HUMAN_IN_LOOP_LABEL,
    "Paid",
    "Person 4 paid their share.",
    "Fronted by the organizer",
    "Approve up to $48",
    "The agent proposed the aquarium; you approve your share.",
  ])("allows copy where a person pays: %s", (text) => {
    expect(pairsAgentWithPaid(text, { speaker: "agent" })).toBe(false);
  });
});
