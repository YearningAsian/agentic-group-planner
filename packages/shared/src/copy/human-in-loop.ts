import type { CardType } from "../enums";

/** Shown on every surface that shows money: the agent only proposes; a person approves. */
export const HUMAN_IN_LOOP_LABEL = "Agent proposed · You approve";

/** Card types whose payload carries an amount, so each must render `HUMAN_IN_LOOP_LABEL`. */
export const MONEY_CARD_TYPES = ["plan", "approval", "booking_confirmed", "price_change"] as const satisfies readonly CardType[];

const PAID = String.raw`(?:paid|pays|paying|will\s+pay)`;
const AGENT_PAID = new RegExp(String.raw`\b(?:the\s+)?agent\s+(?:has\s+|have\s+|just\s+|already\s+)*${PAID}\b`, "i");
const PAID_BY_AGENT = new RegExp(String.raw`\bpaid\s+(?:for\s+)?by\s+(?:the\s+)?agent\b`, "i");
const FIRST_PERSON_PAID = new RegExp(String.raw`\b(?:I|I['’]ve|we|we['’]ve)\s+(?:have\s+|just\s+|already\s+)*${PAID}\b`, "i");

/**
 * True when text makes the agent the one who paid. People pay; the agent proposes. With
 * `speaker: "agent"`, first-person claims ("I paid") count too, because the agent wrote them.
 */
export function pairsAgentWithPaid(text: string, options: { speaker?: "agent" | "person" } = {}): boolean {
  if (AGENT_PAID.test(text) || PAID_BY_AGENT.test(text)) return true;
  return options.speaker === "agent" && FIRST_PERSON_PAID.test(text);
}
