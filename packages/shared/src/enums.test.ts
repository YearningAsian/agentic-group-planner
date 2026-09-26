import { describe, expect, it } from "vitest";
import { enums } from "./enums";

// The database schema's enum table, value for value. The SQL CHECK constraints mirror the same lists.
const expected: Record<string, string[]> = {
  trip_status: ["planning", "active", "completed"],
  member_role: ["organizer", "member"],
  member_status: ["placeholder", "invited", "joined"],
  dietary: ["vegetarian", "vegan", "gluten_free", "halal", "kosher", "nut_free", "dairy_free"],
  place_category: ["food", "activity", "dessert", "nightlife", "lodging", "other"],
  item_status: ["tbd", "proposing", "voting", "decided", "booked", "cancelled", "superseded"],
  option_source: ["cp_sat", "enumeration", "mock", "manual"],
  route_mode: ["walking", "driving"],
  mandate_status: ["open", "partially_declined", "authorized", "captured", "cancelled", "failed"],
  hold_status: ["awaiting_member", "pending", "authorized", "captured", "refunded", "released", "declined", "failed", "expired"],
  hold_kind: ["own", "fronted"],
  booking_provider: ["mock_merchant", "duffel_stays", "stays_mock"],
  booking_status: ["pending", "confirmed", "failed", "cancelled"],
  payer_type: ["split", "organizer", "pay_at_venue"],
  price_action: ["auto_captured", "auto_captured_lower", "reapproval_requested", "notified"],
  sender_type: ["member", "agent", "system"],
  message_kind: ["text", "card"],
  card_type: ["place_list", "plan", "itinerary_change", "summary", "approval", "booking_confirmed", "price_change", "member_joined", "error"],
  run_trigger: ["mention", "price_change", "demo"],
  run_status: ["queued", "running", "succeeded", "failed"],
  tool_name: ["search_places", "plan_day", "update_item", "summarize", "propose_purchase"],
  tool_status: ["started", "succeeded", "failed"],
  webhook_provider: ["stripe"],
  webhook_status: ["received", "processed", "ignored", "failed"],
};

describe("enums", () => {
  it("every enum lists exactly the values in design §3.1", () => {
    expect(Object.keys(enums).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, values] of Object.entries(expected)) {
      expect(enums[name as keyof typeof enums].options, name).toEqual(values);
    }
  });
});
