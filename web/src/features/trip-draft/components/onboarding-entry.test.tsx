import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingEntry } from "./onboarding-entry";

let mockedEntry: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => (key === "entry" ? mockedEntry : null) }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/trip-draft/components/onboarding-flow", () => ({
  OnboardingFlow: () => <p>mock questionnaire flow</p>,
}));

describe("OnboardingEntry", () => {
  it("shows the two-option choice by default", () => {
    mockedEntry = null;
    render(<OnboardingEntry />);
    expect(screen.getByRole("link", { name: /questionnaire/i })).toBeInTheDocument();
    expect(screen.queryByText("mock questionnaire flow")).not.toBeInTheDocument();
  });

  it("renders the questionnaire flow for ?entry=questions", () => {
    mockedEntry = "questions";
    render(<OnboardingEntry />);
    expect(screen.getByText("mock questionnaire flow")).toBeInTheDocument();
  });
});
