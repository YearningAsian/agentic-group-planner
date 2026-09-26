import { MemberJoinedCard } from "@agp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterClaim } from "@/features/invite/server";
import { mandateScenario, paymentsKit, shareRows } from "../payments/kit";
import { adminClient, cleanup, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];

async function joinedCards(tripId: string) {
  const { data, error } = await admin.from("messages").select("*").eq("trip_id", tripId).eq("card_type", "member_joined");
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("afterClaim", () => {
  it("a claim calls onPlaceholderClaimed and writes one member_joined card listing the pending mandate ids", async () => {
    const s = await mandateScenario(batch, payers);
    const person4 = s.person[3];
    const user = await kit.createPayer(batch, "Person 4");
    const joined = await admin
      .from("trip_members")
      .update({ profile_id: user.userId, status: "joined", claimed_at: new Date().toISOString(), invite_token: null })
      .eq("id", person4);
    if (joined.error) throw joined.error;

    const first = await afterClaim(person4);

    expect(first.pendingMandateIds).toEqual([s.mandateId]);
    expect((await shareRows(s.mandateId)).get(`${person4}:own`)).toMatchObject({ status: "pending", payer_member_id: person4 });
    const cards = await joinedCards(s.tripId);
    expect(cards).toHaveLength(1);
    const card = MemberJoinedCard.parse(cards[0]!.card_payload);
    expect(card).toMatchObject({ member_id: person4, display_name: "Person 4", pending_mandate_ids: [s.mandateId] });
    expect(cards[0]).toMatchObject({ id: first.cardMessageId, sender_type: "system", kind: "card" });

    const again = await afterClaim(person4);
    expect(again.cardMessageId).toBe(first.cardMessageId);
    expect(await joinedCards(s.tripId)).toHaveLength(1);
  });
});
