"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Claims the separate invite token, then navigates using the public trip address. */
export function ClaimButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/invites/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.status === 401) {
        setError("Sign in, then open this invite again.");
        return;
      }
      if (!response.ok) {
        setError("Couldn't join this trip. Try again.");
        return;
      }
      const body: unknown = await response.json();
      const slug = typeof body === "object" && body !== null && "trip_slug" in body ? body.trip_slug : null;
      if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(slug)) {
        setError("Couldn't open this trip. Try again.");
        return;
      }
      router.push(`/trip/${slug}`);
    } catch {
      setError("Couldn't join this trip. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => void claim()} disabled={pending}
        className="rounded-lg bg-ink px-5 py-3 text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
        {pending ? "Joining…" : "Join trip"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
