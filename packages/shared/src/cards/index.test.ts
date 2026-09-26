import { describe, expect, it } from "vitest";
import { enums } from "../enums";
import { CardPayload, cardSchemas } from "./index";
import { planCardFixture } from "./fixtures";

describe("CardPayload", () => {
  it("CardPayload picks the schema by card_type", () => {
    expect(Object.keys(cardSchemas).sort()).toEqual([...enums.card_type.options].sort());
    expect(CardPayload.parse(planCardFixture).card_type).toBe("plan");

    const error = { card_type: "error", code: "timeout", message: "The optimizer took too long.", tool: "plan_day", retryable: true, retry_message_id: null };
    expect(CardPayload.parse(error)).toEqual(error);
    // A plan card's fields don't satisfy the error schema, and vice versa.
    expect(CardPayload.safeParse({ ...error, card_type: "plan" }).success).toBe(false);
    expect(CardPayload.safeParse({ ...planCardFixture, card_type: "error" }).success).toBe(false);
    expect(CardPayload.safeParse({ card_type: "nope" }).success).toBe(false);
  });
});
