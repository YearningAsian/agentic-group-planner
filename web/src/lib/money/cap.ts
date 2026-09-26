import { shareCapCents } from "@agp/shared";

/**
 * A share's cap: its price at `percent`, plus the fees on that price, rounded up to a whole
 * dollar. A thin wrapper so callers never do fee math themselves (ADR 0019); `shareCapCents` in
 * `@agp/shared` is the one implementation.
 */
export function capFor(shareCents: number, percent: number): number {
  return shareCapCents(shareCents, percent);
}
