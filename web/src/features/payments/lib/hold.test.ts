import { describe, expect, it } from "vitest";
import { coverRowKey, holdFilter, holdForMetadata, holdOfIntent, holdSuffix } from "./hold";

const mandate = "00000000-0000-4000-8000-0000000000a1";
const organizer = "00000000-0000-4000-8000-0000000000b1";
const person2 = "00000000-0000-4000-8000-0000000000b2";
const person4 = "00000000-0000-4000-8000-0000000000b4";

const row = (share: string, key: string, pi: string | null) => ({
  payer_member_id: organizer,
  share_member_id: share,
  idempotency_key: key,
  stripe_payment_intent_id: pi,
});

describe("holds", () => {
  it("a payer's main hold keeps the original keys; a cover hold adds the covered share", () => {
    expect(holdSuffix(organizer, { kind: "main" })).toBe(organizer);
    expect(holdSuffix(organizer, { kind: "cover", shareMemberId: person2 })).toBe(`${organizer}:cover:${person2}`);
    expect(coverRowKey(mandate, person2)).toBe(`cover:${mandate}:${person2}`);
  });

  it("holdFilter selects only the main hold's rows, or only one cover's", () => {
    expect(holdFilter(mandate, { kind: "main" })).toEqual(["idempotency_key", "not.like", "cover:%"]);
    expect(holdFilter(mandate, { kind: "cover", shareMemberId: person2 })).toEqual(["idempotency_key", "eq", `cover:${mandate}:${person2}`]);
  });

  it("a PaymentIntent is a cover hold only when every row on it is a cover row", () => {
    const rows = [
      row(organizer, `share:${mandate}:${organizer}:own`, "pi_main"),
      row(person4, `share:${mandate}:${person4}:fronted`, "pi_main"),
      row(person2, coverRowKey(mandate, person2), "pi_cover"),
    ];
    expect(holdOfIntent(rows, "pi_main")).toEqual({ payer: organizer, hold: { kind: "main" } });
    expect(holdOfIntent(rows, "pi_cover")).toEqual({ payer: organizer, hold: { kind: "cover", shareMemberId: person2 } });
    expect(() => holdOfIntent(rows, "pi_unknown")).toThrow(/pi_unknown/);
  });

  it("a webhook's metadata names the cover share, or means the main hold", () => {
    expect(holdForMetadata({ mandate_id: mandate, payer_member_id: organizer })).toEqual({ kind: "main" });
    expect(holdForMetadata({ mandate_id: mandate, payer_member_id: organizer, cover_share_member_id: person2 })).toEqual({
      kind: "cover",
      shareMemberId: person2,
    });
  });
});
