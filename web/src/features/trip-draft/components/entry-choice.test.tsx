import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntryChoice } from "./entry-choice";

describe("EntryChoice", () => {
  it("offers Questionnaire and Chat as two clear options", () => {
    render(<EntryChoice />);
    const questions = screen.getByRole("link", { name: /questionnaire/i });
    const chat = screen.getByRole("link", { name: /chat/i });
    expect(questions).toHaveAttribute("href", "/onboarding?entry=questions");
    expect(chat).toHaveAttribute("href", "/studio");
  });
});
