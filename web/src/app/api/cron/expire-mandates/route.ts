import { timingSafeEqual } from "node:crypto";
import { expireMandates } from "@/features/payments/server";
import { getServerEnv } from "@/lib/env/server";
import { AppError, toHttpError } from "@/lib/reliability";

/** Constant-time, so a wrong guess learns nothing from how long the check took. */
function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Scheduled mandate expiry (Vercel cron, `web/vercel.json`). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused before any work. Expiry is
 * conditional and releases by idempotency key, so a duplicate or overlapping call changes nothing.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!bearerMatches(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
      throw new AppError("unauthenticated", "A valid cron token is required.");
    }
    const { expired, failed } = await expireMandates();
    return Response.json({ expired, failed });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
