"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { type BrowserClient, tryGetBrowserClient } from "./browser";

const SupabaseContext = createContext<BrowserClient | null>(null);

const emptySubscribe = () => () => {};

/** Snapshot for both server and client so hydration matches when env is present or absent. */
function readBrowserClient(): BrowserClient | null {
  return tryGetBrowserClient();
}

/**
 * Makes the one browser client available to client components through `useSupabase()`.
 *
 * Uses `tryGetBrowserClient` so SSG/prerender succeeds when public env is missing (common on
 * Vercel previews before project env is wired). The shell still renders; runtime fails clearly
 * once a component actually needs the client (`useSupabase` or `getBrowserClient`).
 */
export function SupabaseProvider({ children }: { children: ReactNode }) {
  const client = useSyncExternalStore(emptySubscribe, readBrowserClient, readBrowserClient);
  return <SupabaseContext value={client}>{children}</SupabaseContext>;
}

export function useSupabase(): BrowserClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error("useSupabase must be used inside <SupabaseProvider>");
  return client;
}
