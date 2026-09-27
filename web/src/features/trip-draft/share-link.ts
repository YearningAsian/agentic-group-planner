const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const DEMO_ORIGIN = "https://grouptrip.app";

/** Six-character code for a demo itinerary link. Avoids ambiguous characters. */
export function randomShareCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/**
 * Share URL shown on the trip summary. Local dev uses the public demo host so the
 * link reads like a real invite instead of a localhost path.
 */
export function itineraryShareUrl(origin: string, code: string): string {
  const local = origin === "" || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const base = local ? DEMO_ORIGIN : origin.replace(/\/$/, "");
  return `${base}/i/${code}`;
}
