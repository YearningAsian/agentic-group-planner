import { type NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { safeNextPath, TRIPS_HOME } from "@/lib/supabase/auth-routes";

const FAILED_LINK = "/login?error=link";

const OTP_TYPES = new Set<string>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

type OtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

function redirect(target: URL): NextResponse {
  const response = NextResponse.redirect(target);
  response.headers.set("cache-control", "no-store");
  return response;
}

function otpType(raw: string | null): OtpType | null {
  if (!raw || !OTP_TYPES.has(raw)) return null;
  return raw as OtpType;
}

/**
 * Exchanges a confirmation or recovery link for a session. Accepts either a `token_hash`
 * (repo email templates) or a PKCE `code` (Supabase defaults), then redirects to a same-origin `next`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const failed = redirect(new URL(FAILED_LINK, origin));
  const next = safeNextPath(searchParams.get("next")) ?? TRIPS_HOME;
  const destination = redirect(new URL(next, origin));

  const tokenHash = searchParams.get("token_hash");
  const type = otpType(searchParams.get("type") ?? (tokenHash ? "email" : null));
  const code = searchParams.get("code");

  try {
    const client = await getServerClient();
    if (tokenHash && type) {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) return failed;
      return destination;
    }
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) return failed;
      return destination;
    }
  } catch {
    return failed;
  }

  return failed;
}
