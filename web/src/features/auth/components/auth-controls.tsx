"use client";

import { useEffect, useState } from "react";
import { DemoLoginPicker } from "@/features/demo";
import { signOut } from "../server/sign-out";
import { sessionLabel } from "../session-label";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Person switcher, and sign-out once a Supabase session exists. */
export function AuthControls({ className }: { className?: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const client = getBrowserClient();
    void client.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const label = sessionLabel(email);

  return (
    <div className={className}>
      <DemoLoginPicker />
      {label ? (
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:bg-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          onClick={() => {
            setPending(true);
            void signOut()
              .then(() => window.location.reload())
              .catch(() => setPending(false));
          }}
        >
          {pending ? "Signing out…" : `Sign out ${label}`}
        </button>
      ) : null}
    </div>
  );
}
