"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { type BrowserClient, getBrowserClient } from "./browser";

const SupabaseContext = createContext<BrowserClient | null>(null);

/** Makes the one browser client available to client components through `useSupabase()`. */
export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getBrowserClient);
  return <SupabaseContext value={client}>{children}</SupabaseContext>;
}

export function useSupabase(): BrowserClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error("useSupabase must be used inside <SupabaseProvider>");
  return client;
}
