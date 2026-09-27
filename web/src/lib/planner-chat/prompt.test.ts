import { describe, expect, it } from "vitest";
import { modelMessages, PLANNER_INSTRUCTIONS, tripContext } from "./prompt";

describe("planner instructions", () => {
  it("asks one question when a place or date is missing, then searches", () => {
    expect(PLANNER_INSTRUCTIONS).toMatch(/ask one short question/i);
    expect(PLANNER_INSTRUCTIONS).not.toMatch(/do not ask/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/search this turn/i);
    expect(PLANNER_INSTRUCTIONS).not.toMatch(/every reply recommends/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/note_stay_area/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/economy/i);
    expect(PLANNER_INSTRUCTIONS.length).toBeLessThan(1100);
  });

  it("sends only confirmed trip facts", () => {
    expect(tripContext(undefined)).toBe("Trip draft: none.");
    expect(tripContext({})).toBe("Trip draft: none.");
    expect(tripContext({ destination: "Miami", budget: 800 })).toBe("Trip draft:\n- Destination: Miami\n- Budget: 800/person");
  });

  it("keeps the latest turn and clips older ones", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `turn ${index} ${"x".repeat(400)}`,
    }));
    const packed = modelMessages(messages);
    const text = (index: number) => {
      const content = packed[index]?.content;
      return typeof content === "string" ? content : "";
    };
    expect(packed).toHaveLength(8);
    expect(text(0).startsWith("turn 4")).toBe(true);
    expect(text(0).length).toBeLessThanOrEqual(160);
    expect(text(7).startsWith("turn 11")).toBe(true);
    expect(text(7).length).toBeGreaterThan(160);
  });
});
