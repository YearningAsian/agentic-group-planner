import { z } from "zod";

/** Handle prefixes: M member, I itinerary item, O option, P place. */
export const HANDLE_KINDS = ["M", "I", "O", "P"] as const;
export type HandleKind = (typeof HANDLE_KINDS)[number];

const HANDLE_PATTERN = /^([MIOP])([1-9]\d*)$/;

/**
 * Short, stable names the model uses instead of UUIDs (`M1`, `I12`). They're assigned per run in a
 * fixed sort order, so the same trip state always yields the same handles.
 */
export const Handle = z.string().regex(HANDLE_PATTERN, "expected a handle like M1, I2, O3, or P4");
export type Handle = z.infer<typeof Handle>;

/** A handle schema that accepts one kind only, e.g. `handleOf("I")` for item handles. */
export function handleOf(kind: HandleKind) {
  return z.string().regex(new RegExp(`^${kind}[1-9]\\d*$`), `expected a ${kind} handle, like ${kind}1`);
}

export function parseHandle(value: string): { kind: HandleKind; index: number } | null {
  const match = HANDLE_PATTERN.exec(value);
  if (!match) return null;
  return { kind: match[1] as HandleKind, index: Number(match[2]) };
}

export function formatHandle(kind: HandleKind, index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError(`handle index must be a positive integer, got ${index}`);
  }
  return `${kind}${index}`;
}
