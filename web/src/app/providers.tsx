"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { SessionGuard, SupabaseProvider } from "@/lib/supabase";

/**
 * Query defaults for the whole app. Realtime events only invalidate queries, so the refetch on
 * window focus is the safety net for events missed while a tab slept.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseProvider>
        <SessionGuard>{children}</SessionGuard>
      </SupabaseProvider>
    </QueryClientProvider>
  );
}
