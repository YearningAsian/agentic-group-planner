import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openCheckoutMandate } from "@/features/payments/server";
import { AppError } from "@/lib/reliability";
import { createGroupCheckout, readPaidSession } from "./group-checkout";

vi.mock("@/features/payments/server", () => ({
  openCheckoutMandate: vi.fn(),
}));

const tripId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const mandateId = "77777777-7777-4777-8777-777777777777";
const memberId = "55555555-5555-4555-8555-555555555555";
const profileId = "44444444-4444-4444-8444-444444444444";

function stripeDouble() {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
    void params;
    void options;
    return { id: "cs_test_1", url: "https://checkout.stripe.test/pay" };
  });
  const retrieveSession = vi.fn();
  const retrieveIntent = vi.fn();
  return {
    create,
    retrieveSession,
    retrieveIntent,
    stripe: {
      checkout: { sessions: { create, retrieve: retrieveSession } },
      paymentIntents: { retrieve: retrieveIntent },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createGroupCheckout", () => {
  it("rejects a body without a saved trip before Stripe or a mandate write", async () => {
    const { create, stripe } = stripeDouble();
    await expect(createGroupCheckout({}, { profileId, stripe: stripe as never })).rejects.toMatchObject({
      message: "That checkout request is missing a traveler or a pick.",
    });
    expect(openCheckoutMandate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not open a session when the trip, item, or option is missing", async () => {
    const { create, stripe } = stripeDouble();
    vi.mocked(openCheckoutMandate).mockRejectedValue(
      new AppError("invalid_input", "A saved trip with a decided option is required before checkout."),
    );
    await expect(createGroupCheckout({ tripId, itemId, optionId }, { profileId, stripe: stripe as never })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a manual-capture session with mandate metadata and no payment_method_types", async () => {
    const { create, stripe } = stripeDouble();
    vi.mocked(openCheckoutMandate).mockResolvedValue({
      mandateId,
      tripId,
      currency: "usd",
      holds: [{ memberId, name: "Ada", capCents: 4800, status: "pending" }],
    });
    const result = await createGroupCheckout({ tripId, itemId, optionId }, { profileId, stripe: stripe as never, appUrl: "http://localhost:3000" });

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0]!;
    expect(params!.payment_intent_data).toEqual({
      capture_method: "manual",
      metadata: {
        trip_id: tripId,
        mandate_id: mandateId,
        payer_member_id: memberId,
        share_member_id: memberId,
      },
    });
    expect(params).not.toHaveProperty("payment_method_types");
    const line = params!.line_items?.[0];
    const price = line && "price_data" in line ? line.price_data : undefined;
    expect(price && "unit_amount" in price ? price.unit_amount : undefined).toBe(4800);
    expect(options).toEqual({ idempotencyKey: `group-checkout:${mandateId}:${memberId}` });
    expect(result.links).toEqual([
      expect.objectContaining({ memberId, url: "https://checkout.stripe.test/pay", status: "pending", totalCents: 4800 }),
    ]);
  });

  it("authorizes each draft traveler with manual capture and records the whole group before anyone is charged", async () => {
    let n = 0;
    const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
      n += 1;
      return { id: `cs_test_${n}`, url: `https://checkout.stripe.test/${n}`, metadata: params.metadata ?? {} };
    });
    const update = vi.fn(async (id: string, params: Stripe.Checkout.SessionUpdateParams) => {
      void id;
      void params;
      return {};
    });
    const stripe = { checkout: { sessions: { create, update } }, paymentIntents: { retrieve: vi.fn() } };
    const result = await createGroupCheckout(
      {
        destinationId: "lisbon",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        members: [
          { id: "p1", name: "Ada", flightId: "live-flight", stayId: "live-stay" },
          { id: "p2", name: "Bea", flightId: "live-flight", stayId: "live-stay" },
        ],
        chosenFlight: {
          id: "live-flight",
          airline: "TAP",
          origin: "JFK",
          destination: "LIS",
          departure: "2026-06-01T08:00:00",
          arrival: "2026-06-01T18:00:00",
          stops: 0,
          price: 400,
          currency: "USD",
        },
        chosenStay: {
          id: "live-stay",
          name: "Harbor",
          area: "Alfama",
          nightlyAmount: 200,
          currency: "USD",
          guestScore: null,
          image: null,
        },
      },
      { profileId, stripe: stripe as never, appUrl: "http://localhost:3000" },
    );

    expect(openCheckoutMandate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      expect(call[0]?.payment_intent_data).toMatchObject({ capture_method: "manual" });
      expect(call[0]).not.toHaveProperty("payment_method_types");
    }
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.[1]?.metadata).toMatchObject({ peer_session_ids: "cs_test_1,cs_test_2" });
    expect(result.mandateId).toBeNull();
    expect(result.links.map((link) => link.memberId)).toEqual(["p1", "p2"]);
  });
});

describe("readPaidSession", () => {
  it("treats a completed session whose PaymentIntent requires capture as authorized, and paid as captured", async () => {
    const { retrieveSession, retrieveIntent, stripe } = stripeDouble();
    retrieveSession.mockResolvedValueOnce({
      status: "complete",
      payment_status: "unpaid",
      payment_intent: "pi_held",
      metadata: { member_id: memberId },
      client_reference_id: memberId,
    });
    retrieveIntent.mockResolvedValueOnce({ id: "pi_held", status: "requires_capture" });
    await expect(readPaidSession("cs_test_held", { stripe: stripe as never })).resolves.toEqual({ state: "authorized", memberId });

    retrieveSession.mockResolvedValueOnce({
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_paid",
      metadata: { member_id: memberId },
    });
    await expect(readPaidSession("cs_test_paid", { stripe: stripe as never })).resolves.toEqual({ state: "paid", memberId });
  });
});
