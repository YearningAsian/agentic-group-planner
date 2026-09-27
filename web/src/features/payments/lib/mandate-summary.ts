import type { ApprovalCard } from "@agp/shared";
import { formatUsd } from "@/lib/money";

/**
 * The facts the model gets back from `propose_purchase`: the total, the cap, and each share with
 * its cap, in dollars. Built only from the card, so the stored ToolResult and a replayed one match.
 * People approve and pay; the text never says the agent did.
 */
export function mandateSummary(card: ApprovalCard): string {
  const names = new Map(card.shares.map((s) => [s.member_id, s.display_name]));
  const shares = card.shares
    .map((s) => {
      const line = `${s.display_name} ${formatUsd(s.share_cents)} (up to ${formatUsd(s.cap_cents)})`;
      if (!s.covered_by_member_id) return line;
      return `${line}, fronted by ${names.get(s.covered_by_member_id) ?? "the organizer"} until they join`;
    })
    .join("; ");
  const text =
    `Posted an approval card for ${card.title}: ${formatUsd(card.quote_cents)} total, up to ${formatUsd(card.cap_cents)} ` +
    `if the price changes. Shares: ${shares}. Each member approves their own hold on the card.`;
  return text.slice(0, 600);
}
