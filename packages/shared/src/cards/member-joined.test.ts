import { describe, expect, it } from "vitest";
import { MemberJoinedCard } from "./member-joined";

const card = {
  card_type: "member_joined",
  member_id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  display_name: "Person 4",
  lane_color: "#8b5cf6",
  pending_mandate_ids: ["9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"],
};

describe("MemberJoinedCard", () => {
  it("accepts the design §2.1 fields", () => {
    expect(MemberJoinedCard.parse(card)).toEqual(card);
  });

  it("requires pending_mandate_ids, even when empty", () => {
    expect(MemberJoinedCard.parse({ ...card, pending_mandate_ids: [] }).pending_mandate_ids).toEqual([]);
    const { pending_mandate_ids: _, ...missing } = card;
    expect(MemberJoinedCard.safeParse(missing).success).toBe(false);
  });

  it("strips unknown keys", () => {
    expect(MemberJoinedCard.parse({ ...card, amount_cents: 4200 })).not.toHaveProperty("amount_cents");
  });
});
