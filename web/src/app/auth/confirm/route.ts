import { type NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

const DEFAULT_NEXT = "/trips";
const FAILED_LINK = "/login?error=link";

/**
 * The same-origin URL for `next`, or null for anything that could leave the site. Resolving it
 * with the URL parser catches what a prefix check misses: `//host`, `/\host`, and tabs or
 * newlines inside the scheme-relative prefix, which browsers all treat as another origin.
 */
function sameOriginTarget(next: string | null, origin: string): URL | null {
  if (!next?.startsWith("/")) return null;
  try {
    const target = new URL(next, origin);
    return target.origin === origin ? target : null;
  } catch {
    return null;
  }
}

function redirect(target: URL): NextResponse {
  const response = NextResponse.redirect(target);
  // This response may carry the session cookie, so no cache may store it and replay it to someone else.
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * Verifies a magic link's `token_hash` (design §2.4), which sets the session cookie through the
 * server client, then redirects to `next` if it's a same-origin path, or to `/` otherwise. A
 * missing, used, or expired link goes to `FAILED_LINK`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") ?? "email";
  const failed = redirect(new URL(FAILED_LINK, origin));

  // The template only ever sends `type=email`; recovery and email-change links aren't part of sign-in.
  if (!tokenHash || type !== "email") return failed;

  try {
    const client = await getServerClient();
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) return failed;
  } catch {
    return failed;
  }

  return redirect(sameOriginTarget(searchParams.get("next"), origin) ?? new URL(DEFAULT_NEXT, origin));
}
