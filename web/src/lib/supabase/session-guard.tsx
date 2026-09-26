"use client";

import type { ReactNode } from "react";

/**
 * Will sign out and route to `/login` (or the saved invite link) when Supabase reports an invalid
 * user or JWT, for example after `reset:demo`. A pass-through until that's built.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  return children;
}
