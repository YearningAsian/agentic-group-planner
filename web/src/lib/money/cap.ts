import { shareCapCents } from "@agp/shared";

/**
 * One share's cap at `percent` (100–125), including the fees on it (ADR 0019). `shareCapCents` in
 * `@agp/shared` is the only fee math; this is its name in the payments code.
 */
export function capFor(shareCents: number, percent: number): number {
  return shareCapCents(shareCents, percent);
}
