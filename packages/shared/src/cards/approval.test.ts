import { describe, expect, it } from "vitest";
import { ApprovalCard, ApprovalHold, ApprovalShare } from "./approval";

const person = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

// The seeded trip: four $42 tickets, Person 4 a placeholder whose share Person 1 fronts.
const memberHold = (n: number) => ({
  payer_member_id: person(n),
  share_member_ids: [person(n)],
  share_cents: 4200,
  processor_fee_cents: 157,
  platform_fee_cents: 0,
  total_cents: 4357,
  cap_cents: 4800,
});

const seededCard = {
  card_type: "approval",
  mandate_id: "00000000-0000-4000-8000-0000000000e1",
  item_id: "00000000-0000-4000-8000-0000000000a1",
  title: "Georgia Aquarium · 4 tickets",
  merchant: "Demo Tickets (mock merchant)",
  quote_cents: 16800,
  cap_cents: 19200,
  currency: "usd",
  expires_at: "2026-09-27T14:00:00+00:00",
  holds: [
    {
      payer_member_id: person(1),
      share_member_ids: [person(1), person(4)],
      share_cents: 8400,
      processor_fee_cents: 282,
      platform_fee_cents: 0,
      total_cents: 8682,
      cap_cents: 9600,
    },
    memberHold(2),
    memberHold(3),
    memberHold(4),
  ],
  shares: [1, 2, 3, 4].map((n) => ({
    member_id: person(n),
    display_name: `Person ${n}`,
    share_cents: 4200,
    cap_cents: 4800,
    covered_by_member_id: n === 4 ? person(1) : null,
  })),
};

describe("approval card", () => {
  it("an approval share's cap_cents is at least its share_cents", () => {
    const share = seededCard.shares[0]!;
    expect(ApprovalShare.safeParse(share).success).toBe(true);
    expect(ApprovalShare.safeParse({ ...share, cap_cents: 4200 }).success).toBe(true);
    expect(ApprovalShare.safeParse({ ...share, cap_cents: 4199 }).success).toBe(false);
    expect(ApprovalShare.safeParse({ ...share, share_cents: 42.5 }).success).toBe(false);
  });

  it("each approval hold carries share, processor fee, platform fee, total, and cap cents, and the platform fee is present even at 0", () => {
    const hold = seededCard.holds[0]!;
    expect(ApprovalHold.parse(hold).platform_fee_cents).toBe(0);

    for (const field of ["share_cents", "processor_fee_cents", "platform_fee_cents", "total_cents", "cap_cents"] as const) {
      const { [field]: _dropped, ...rest } = hold;
      expect(ApprovalHold.safeParse(rest).success, `without ${field}`).toBe(false);
      expect(ApprovalHold.safeParse({ ...hold, [field]: -1 }).success, `negative ${field}`).toBe(false);
    }
    // The itemized lines add up to the total, and the cap never sits below it.
    expect(ApprovalHold.safeParse({ ...hold, total_cents: 8681 }).success).toBe(false);
    expect(ApprovalHold.safeParse({ ...hold, cap_cents: 8600 }).success).toBe(false);
    expect(ApprovalHold.safeParse({ ...hold, share_member_ids: [] }).success).toBe(false);
  });

  it("the seeded card validates, with its quote the sum of the shares and its cap the sum of the share caps", () => {
    expect(ApprovalCard.parse(seededCard)).toEqual(seededCard);
    expect(ApprovalCard.safeParse({ ...seededCard, note: "Tickets are timed entry." }).success).toBe(true);
    expect(ApprovalCard.safeParse({ ...seededCard, quote_cents: 16801 }).success).toBe(false);
    expect(ApprovalCard.safeParse({ ...seededCard, cap_cents: 19600 }).success).toBe(false);
    expect(ApprovalCard.safeParse({ ...seededCard, currency: "eur" }).success).toBe(false);
    expect(ApprovalCard.safeParse({ ...seededCard, expires_at: "tomorrow" }).success).toBe(false);
  });
});
