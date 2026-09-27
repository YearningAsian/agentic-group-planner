"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEMO_PEOPLE } from "../demo-people";
import { demoSignInSeeded } from "../server/demo-sign-in";
import { safeNextPath, TRIPS_HOME } from "@/lib/supabase/auth-routes";
import { cn } from "cn";

const LANE_CLASS: Record<number, string> = {
  1: "border-lane-1/40 bg-lane-1/10 text-lane-1",
  2: "border-lane-2/40 bg-lane-2/10 text-lane-2",
  3: "border-lane-3/40 bg-lane-3/10 text-lane-3",
};

/**
 * One-tap Person 1–3 cards for demo mode. Hidden unless `NEXT_PUBLIC_DEMO_MODE=true`.
 * Credentials stay on the server (`demoSignInSeeded`).
 */
export function InstantLoginCards({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;

  return (
    <section id="demo" className="space-y-3" aria-labelledby="demo-heading">
      <div>
        <h2 id="demo-heading" className="text-base font-semibold text-ink">
          Try it as someone in the group
        </h2>
        <p className="mt-1 text-sm text-muted">Demo accounts. Data resets.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {DEMO_PEOPLE.map((person) => {
          const label = person.role ? `${person.name} · ${person.role}` : person.name;
          return (
            <li key={person.key}>
              <button
                type="button"
                disabled={pending !== null}
                aria-label={`Sign in as ${label}`}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition duration-200",
                  "hover:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  "disabled:cursor-wait disabled:opacity-60",
                  LANE_CLASS[person.lane],
                )}
                onClick={() => {
                  setPending(person.key);
                  setError("");
                  startTransition(() => {
                    void demoSignInSeeded(person.key)
                      .then((result) => {
                        if (result.ok) {
                          router.replace(safeNextPath(next) ?? TRIPS_HOME);
                          router.refresh();
                          return;
                        }
                        setPending(null);
                        setError(result.message);
                      })
                      .catch(() => {
                        setPending(null);
                        setError("Couldn't sign in.");
                      });
                  });
                }}
              >
                <span
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-sm font-bold shadow-sm"
                  aria-hidden
                >
                  {person.name.replace("Person ", "P")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{person.name}</span>
                  {person.role ? (
                    <span className="block truncate text-xs text-muted">{person.role}</span>
                  ) : null}
                </span>
                {pending === person.key ? (
                  <span className="ml-auto text-xs font-medium text-muted">Signing in…</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">
        {error || null}
      </div>
    </section>
  );
}
