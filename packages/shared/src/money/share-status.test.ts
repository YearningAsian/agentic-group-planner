import { describe, expect, it } from "vitest";
import { shareStatus } from "./share-status";

const own = (status: string, cap_cents = 4800) => ({ kind: "own" as const, status, share_cents: 4200, cap_cents });
const fronted = (status: string) => ({ kind: "fronted" as const, status, share_cents: 4200, cap_cents: 4800 });

describe("shareStatus", () => {
  it("a member's own pending row asks them to approve up to their cap", () => {
    expect(shareStatus([own("pending")])).toEqual({ status: "pending", label: "Approve up to $48", share_cents: 4200 });
  });

  it("an authorized own row is approved, and a captured one is paid", () => {
    expect(shareStatus([own("authorized")])).toMatchObject({ status: "authorized", label: "Approved, up to $48" });
    expect(shareStatus([own("captured")])).toMatchObject({ status: "paid", label: "Paid" });
  });

  it("a placeholder's share reads Fronted by the organizer until their own row is captured, then Paid", () => {
    expect(shareStatus([own("awaiting_member"), fronted("pending")])).toMatchObject({ status: "awaiting_member" });
    expect(shareStatus([own("awaiting_member"), fronted("authorized")])).toMatchObject({ status: "fronted", label: "Fronted by the organizer" });
    expect(shareStatus([own("pending"), fronted("captured")])).toMatchObject({ status: "fronted", label: "Fronted by the organizer" });
    expect(shareStatus([own("captured"), fronted("refunded")])).toMatchObject({ status: "paid", label: "Paid" });
  });

  it("no rows, or rows that ended without paying, mean no payment", () => {
    expect(shareStatus([])).toEqual({ status: "none", label: "No payment", share_cents: null });
    expect(shareStatus([own("declined")])).toMatchObject({ status: "none", label: "Declined" });
    expect(shareStatus([own("released")])).toMatchObject({ status: "none", label: "No payment" });
  });

  it("shows cents only when there are some", () => {
    expect(shareStatus([own("pending", 4850)]).label).toBe("Approve up to $48.50");
  });
});
