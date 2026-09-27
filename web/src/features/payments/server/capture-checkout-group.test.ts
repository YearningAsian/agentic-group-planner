import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { captureCheckoutGroup } from "./capture-checkout-group";

function intent(id: string, status: Stripe.PaymentIntent.Status): Stripe.PaymentIntent {
  return { id, status, capture_method: "manual" } as Stripe.PaymentIntent;
}

function session(id: string, status: Stripe.Checkout.Session.Status, paymentIntent: Stripe.PaymentIntent | null): Stripe.Checkout.Session {
  return {
    id,
    status,
    payment_intent: paymentIntent,
    metadata: { group_id: "group-1", peer_session_ids: "cs_a,cs_b", member_id: id },
  } as unknown as Stripe.Checkout.Session;
}

describe("captureCheckoutGroup", () => {
  it("does not capture when the other traveler has not paid", async () => {
    const capture = vi.fn();
    const stripe = {
      checkout: {
        sessions: {
          list: async () => ({ data: [session("cs_a", "complete", intent("pi_a", "requires_capture"))] }),
          retrieve: async (id: string) =>
            id === "cs_a"
              ? session("cs_a", "complete", intent("pi_a", "requires_capture"))
              : session("cs_b", "open", null),
        },
      },
      paymentIntents: { capture },
    } as unknown as Stripe;

    await expect(captureCheckoutGroup("pi_a", stripe)).resolves.toBe("waiting");
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures every hold once all travelers are authorized", async () => {
    const capture = vi.fn(async (id: string) => {
      void id;
      return {};
    });
    const stripe = {
      checkout: {
        sessions: {
          list: async () => ({ data: [session("cs_a", "complete", intent("pi_a", "requires_capture"))] }),
          retrieve: async (id: string) =>
            session(id, "complete", intent(id === "cs_a" ? "pi_a" : "pi_b", "requires_capture")),
        },
      },
      paymentIntents: { capture },
    } as unknown as Stripe;

    await expect(captureCheckoutGroup("pi_a", stripe)).resolves.toBe("captured");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls.map((call) => call[0])).toEqual(["pi_a", "pi_b"]);
  });
});
