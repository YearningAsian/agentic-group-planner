"use client";

import { useState } from "react";
import { demoSignInSeeded } from "@/features/demo/server/demo-sign-in";

const PEOPLE = ["person1", "person2", "person3"] as const;

/** Dev-mode switcher. Hidden unless NEXT_PUBLIC_DEMO_MODE is true. */
export function DemoLoginPicker() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2">
      {PEOPLE.map((person) => (
        <button
          key={person}
          type="button"
          disabled={pending !== null}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:bg-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          onClick={() => {
            setPending(person);
            setError("");
            void demoSignInSeeded(person)
              .then((result) => {
                if (result.ok) return window.location.reload();
                setPending(null);
                setError(result.message);
              })
              .catch(() => {
                setPending(null);
                setError("Couldn't sign in.");
              });
          }}
        >
          {pending === person ? "Signing in…" : person.replace("person", "Person ")}
        </button>
      ))}
      {error ? <p className="w-full text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
