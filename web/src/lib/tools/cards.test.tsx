import { CardType } from "@agp/shared";
import { errorCardFixture, planCardFixture } from "@agp/shared/fixtures";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cardRenderers, type CardMessage, renderCard } from "./cards";

function message(card_type: string, card_payload: unknown): CardMessage {
  return { id: "00000000-0000-4000-8000-0000000000e1", card_type, card_payload, created_at: "2026-09-26T14:00:00+00:00" };
}

describe("renderCard", () => {
  it("renderCard resolves a renderer for all 11 card types", () => {
    expect(Object.keys(cardRenderers).sort()).toEqual([...CardType.options].sort());
    for (const type of CardType.options) expect(typeof cardRenderers[type]).toBe("function");

    render(<>{renderCard(message("plan", planCardFixture))}</>);
    expect(screen.getByRole("article", { name: "plan card" })).toBeInTheDocument();
    render(<>{renderCard(message("error", errorCardFixture))}</>);
    expect(screen.getByText("The planner is unavailable right now.")).toBeInTheDocument();
  });

  it("a payload that fails its schema renders the unavailable state", () => {
    render(<>{renderCard(message("plan", { card_type: "plan", applied_plan_rank: 2 }))}</>);
    expect(screen.getByText("This card is out of date.")).toBeInTheDocument();
  });

  it("a payload whose card_type disagrees with the row renders the unavailable state", () => {
    render(<>{renderCard(message("plan", errorCardFixture))}</>);
    expect(screen.getByText("This card is out of date.")).toBeInTheDocument();
  });
});
