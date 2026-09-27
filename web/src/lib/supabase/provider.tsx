"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { EnvError } from "@/lib/env/error";
import { type BrowserClient, getBrowserClient } from "./browser";

const SupabaseContext = createContext<BrowserClient | null>(null);

/**
 * Makes the one browser client available to client components through `useSupabase()`.
 *
 * Creation is deferred when public env is missing during SSG/prerender (common on Vercel
 * previews before project env is wired). The shell still renders; runtime fails clearly once
 * a component actually needs the client.
 */
export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<BrowserClient | null>(() => {
    try {
      return getBrowserClient();
    } catch (error) {
      if (typeof window === "undefined" && error instanceof EnvError) return null;
      throw error;
    }
  });

  useEffect(() => {
    if (client) return;
    setClient(getBrowserClient());
  }, [client]);

  return <SupabaseContext value={client}>{children}</SupabaseContext>;
}

export function useSupabase(): BrowserClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error("useSupabase must be used inside <SupabaseProvider>");
  return client;
}
