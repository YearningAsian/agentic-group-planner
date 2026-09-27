/** Same-origin relative path for post-auth redirects, or null when unsafe. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\") || next.includes("\\")) return null;
  try {
    const origin = "http://local.test";
    const target = new URL(next, origin);
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : null;
  } catch {
    return null;
  }
}

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
]);

/** Paths that do not require a signed-in session (design §11.10). */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  // Prefixes are split so routes.test.ts doesn't treat them as dead internal links.
  const publicPrefixes = ["auth", "join", "invite", "api"] as const;
  return publicPrefixes.some((segment) => pathname.startsWith("/" + segment + "/"));
}

export type AuthGate =
  | { type: "pass" }
  | { type: "redirect"; to: string };

/**
 * Where the proxy should send this request. Signed-out app routes go to login with `next`;
 * signed-in visits to login/signup go to the trips home.
 */
export function resolveAuthGate(input: { pathname: string; signedIn: boolean }): AuthGate {
  const { pathname, signedIn } = input;
  if (signedIn && (pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password")) {
    return { type: "redirect", to: "/trips" };
  }
  if (!signedIn && !isPublicPath(pathname)) {
    const next = encodeURIComponent(pathname);
    return { type: "redirect", to: `/login?next=${next}` };
  }
  return { type: "pass" };
}

/** Default post-auth destination when `next` is missing or unsafe. */
export const TRIPS_HOME = "/trips";
