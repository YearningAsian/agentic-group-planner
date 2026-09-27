import { describe, expect, it } from "vitest";
import {
  ApproveBody,
  ApproveResponse,
  CancelBody,
  CancelResponse,
  CoverBody,
  CoverResponse,
  DeclineBody,
  DeclineResponse,
  MandateParams,
} from "./mandates";

describe("mandate routes", () => {
  it("approve, decline, cover, and cancel take an empty body, so a client can't send an amount", () => {
    for (const body of [ApproveBody, DeclineBody, CoverBody, CancelBody]) {
      expect(body.safeParse({}).success).toBe(true);
      expect(body.safeParse({ amount_cents: 4800 }).success).toBe(false);
    }
    expect(MandateParams.safeParse({ id: "00000000-0000-4000-8000-0000000000e1" }).success).toBe(true);
    expect(MandateParams.safeParse({ id: "e1" }).success).toBe(false);
  });

  it("responses carry hold and mandate statuses from the enums", () => {
    const holdId = "00000000-0000-4000-8000-0000000000f3";
    expect(ApproveResponse.safeParse({ holds: [{ hold_id: holdId, status: "authorized" }] }).success).toBe(true);
    expect(ApproveResponse.safeParse({ holds: [{ hold_id: holdId, status: "approved" }] }).success).toBe(false);
    expect(DeclineResponse.safeParse({ hold_status: "declined", mandate_status: "partially_declined" }).success).toBe(true);
    expect(CoverResponse.safeParse({ mandate_status: "authorized" }).success).toBe(true);
    expect(CoverResponse.safeParse({ mandate_status: "covered" }).success).toBe(false);
    expect(CancelResponse.safeParse({ mandate_status: "cancelled" }).success).toBe(true);
    expect(CancelResponse.safeParse({ mandate_status: "canceled" }).success).toBe(false);
  });
});
