import { createHash, timingSafeEqual } from "node:crypto";
import { expireMandates } from "@/features/payments/server";
import { getServerEnv } from "@/lib/env/server";
import { AppError, toHttpError } from "@/lib/reliability";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compares fixed-size digests in constant time, so neither timing nor length says anything about the secret. */
function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/**
 * Scheduled mandate expiry (Vercel cron, `web/vercel.json`). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused before any work. Expiry is
 * conditional and releases by idempotency key, so a duplicate or overlapping call changes nothing.
 * A run where some releases failed answers 500, so the cron log shows it; the next run retries them.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!bearerMatches(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
      throw new AppError("unauthenticated", "A valid cron token is required.");
    }
    const { expired, failed } = await expireMandates();
    return Response.json({ expired, failed }, { status: failed.length > 0 ? 500 : 200 });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
