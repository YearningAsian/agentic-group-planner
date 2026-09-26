import { frontedShareRefundCents } from "@agp/shared";
import { describe, expect, it } from "vitest";
import { planCaptures, type ShareRow } from "./plan-captures";

const row = (
  shareMemberId: string,
  kind: ShareRow["kind"],
  status: string,
  paymentIntentId: string | null,
  payerMemberId: string | null = kind === "fronted" ? "person1" : shareMemberId,
): ShareRow => ({ id: `${shareMemberId}:${kind}`, shareMemberId, payerMemberId, kind, status, shareCents: 4200, paymentIntentId });

/** The seeded mandate once Persons 1–3 approved; Person 4's own row as given. */
function seeded(person4Own: { status: string; paymentIntentId: string | null; payer: string | null }): ShareRow[] {
  return [
    row("person1", "own", "authorized", "pi_person1"),
    row("person2", "own", "authorized", "pi_person2"),
    row("person3", "own", "authorized", "pi_person3"),
    row("person4", "fronted", "authorized", "pi_person1"),
    row("person4", "own", person4Own.status, person4Own.paymentIntentId, person4Own.payer),
  ];
}

describe("planCaptures", () => {
  it("Person 4's own row authorized: pi_person4 captures 4357, pi_person1 captures 4357, and the fronted row is released", () => {
    const plan = planCaptures(seeded({ status: "authorized", paymentIntentId: "pi_person4", payer: "person4" }));
    expect(Object.fromEntries(plan.captureByIntent)).toEqual({ pi_person1: 4357, pi_person2: 4357, pi_person3: 4357, pi_person4: 4357 });
    expect(plan.release.map((r) => r.id)).toEqual(["person4:fronted"]);
    expect(plan.paying.map((r) => r.id).sort()).toEqual(["person1:own", "person2:own", "person3:own", "person4:own"]);
    expect(plan.releaseIntents).toEqual([]);
  });

  it("Person 4's own row awaiting_member: pi_person1 captures 8682 for its own and fronted rows", () => {
    const plan = planCaptures(seeded({ status: "awaiting_member", paymentIntentId: null, payer: null }));
    expect(plan.captureByIntent.get("pi_person1")).toBe(8682);
    expect(plan.release).toEqual([]);
    // Each paying row's part of its capture; the fronted row's part is what a later refund returns.
    expect(plan.capturedCentsByRow.get("person1:own")).toBe(4357);
    expect(plan.capturedCentsByRow.get("person4:fronted")).toBe(frontedShareRefundCents({ ownSharesCents: [4200], frontedShareCents: 4200 }));
    expect([...plan.capturedCentsByRow.values()].reduce((a, b) => a + b, 0)).toBe(8682 + 4357 * 2);
  });

  it("every share has exactly one paying row", () => {
    const statuses = ["authorized", "pending", "awaiting_member", "declined", "released"];
    for (const own4 of statuses) {
      for (const fronted of ["authorized", "pending", "declined"]) {
        const rows = [
          row("person1", "own", "authorized", "pi_person1"),
          row("person2", "own", "authorized", "pi_person2"),
          row("person4", "fronted", fronted, "pi_person1"),
          row("person4", "own", own4, own4 === "awaiting_member" ? null : "pi_person4", own4 === "awaiting_member" ? null : "person4"),
        ];
        const plan = planCaptures(rows);
        const payingShares = plan.paying.map((r) => r.shareMemberId);
        expect(new Set(payingShares).size, `${own4}/${fronted}`).toBe(payingShares.length);
        const coverable = new Set(rows.filter((r) => r.status === "authorized").map((r) => r.shareMemberId));
        expect(new Set(payingShares), `${own4}/${fronted}`).toEqual(coverable);
        // Every authorized row either pays or is released, never both.
        const authorized = rows.filter((r) => r.status === "authorized").map((r) => r.id).sort();
        expect([...plan.paying, ...plan.release].map((r) => r.id).sort(), `${own4}/${fronted}`).toEqual(authorized);
        // A share's own authorized row always wins over the organizer's fronted row.
        if (own4 === "authorized") expect(plan.paying.find((r) => r.shareMemberId === "person4")!.kind).toBe("own");
      }
    }
  });

  it("a PaymentIntent that pays nothing is released instead of captured", () => {
    // The organizer isn't attending: their hold only fronts Person 4, who paid their own share.
    const rows = [
      row("person2", "own", "authorized", "pi_person2"),
      row("person4", "fronted", "authorized", "pi_person1"),
      row("person4", "own", "authorized", "pi_person4"),
    ];
    const plan = planCaptures(rows);
    expect(plan.captureByIntent.has("pi_person1")).toBe(false);
    expect(plan.releaseIntents).toEqual(["pi_person1"]);
  });
});
