import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDays } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { CardFrame } from "./card-frame";
import { ErrorCard } from "./error-card";

const base = { icon: CalendarDays, title: "Plan for Saturday", actor: "agent" as const, timestamp: "2026-09-26T14:00:00+00:00" };

describe("CardFrame", () => {
  it("renders an article labelled by its title", () => {
    render(
      <CardFrame {...base} subtitle="3 slots" state="ready" status={{ tone: "info", label: "Voting" }}>
        <p>body</p>
      </CardFrame>,
    );
    const card = screen.getByRole("article", { name: "Plan for Saturday" });
    expect(card).toHaveTextContent("Agent");
    expect(card).toHaveTextContent("Voting");
    expect(card).toHaveTextContent("body");
  });

  it("action buttons show a spinner and aria-busy while pending, and keep their label", async () => {
    const onPress = vi.fn();
    render(
      <CardFrame {...base} state="ready" actions={[{ label: "Approve up to $47", onPress, variant: "primary", pending: true }]}>
        <p>body</p>
      </CardFrame>,
    );
    const button = screen.getByRole("button", { name: "Approve up to $47" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector("[data-slot=spinner]")).not.toBeNull();
    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('the unavailable state reads "This card is out of date."', () => {
    render(
      <CardFrame {...base} state="unavailable">
        <p>stale body</p>
      </CardFrame>,
    );
    expect(screen.getByRole("article", { name: "Plan for Saturday" })).toHaveTextContent("This card is out of date.");
    expect(screen.queryByText("stale body")).toBeNull();
  });
});

describe("ErrorCard", () => {
  const payload = {
    card_type: "error" as const,
    code: "provider_unavailable" as const,
    message: "The planner is unavailable right now.",
    tool: "plan_day",
    retryable: true,
    retry_message_id: null,
  };

  it("shows the message, and Try again only when retryable and a retry handler exists", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorCard payload={payload} timestamp={base.timestamp} onRetry={onRetry} />);
    expect(screen.getByRole("article", { name: "Something went wrong" })).toHaveTextContent("The planner is unavailable right now.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<ErrorCard payload={{ ...payload, retryable: false }} timestamp={base.timestamp} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
