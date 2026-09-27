import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { EnvError } from "@/lib/env/error";
import { getServerClient } from "@/lib/supabase/server";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Group Trip Agent",
  description:
    "An AI travel agent in your group chat that finds the options, builds the itinerary, and lets everyone approve and pay their own share.",
};

/** Session check for CTA copy. Missing public env (preview builds) → signed out. */
async function readSignedIn(): Promise<boolean> {
  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    return Boolean(data.user);
  } catch (error) {
    if (error instanceof EnvError) return false;
    throw error;
  }
}

/** Temporary public home until FE-S09 ships the full marketing page. */
export default async function MarketingHomePage() {
  const signedIn = await readSignedIn();

  return (
    <main className={`${jakarta.variable} ${fraunces.variable} marketing-surface min-h-dvh px-5 py-16 antialiased`}>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <p className="text-sm font-bold tracking-tight text-ink">Group Trip Agent</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink text-balance">
          Plan it together. Pay your part.
        </h1>
        <p className="text-base text-muted text-pretty">
          An AI travel agent in your group chat that finds the options, builds the itinerary, and lets everyone
          approve and pay their own share.
        </p>
        <div className="flex flex-wrap gap-3">
          {signedIn ? (
            <Link
              href="/trips"
              className="inline-flex h-11 items-center rounded-full bg-coral px-5 text-sm font-semibold text-ink hover:bg-coral/90"
            >
              Open my trips
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                className="inline-flex h-11 items-center rounded-full bg-coral px-5 text-sm font-semibold text-ink hover:bg-coral/90"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-full border border-line bg-paper px-5 text-sm font-semibold text-ink hover:bg-mist"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
