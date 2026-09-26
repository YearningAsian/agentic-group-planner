// Client-safe entry point. Other code imports this feature only through this file or server.ts.
// Stubs until the feature's owner builds them.
import { notBuilt } from "@/lib/not-built";

export function ApprovalCard(): null {
  return null;
}

export function PriceChangeCard(): null {
  return null;
}

export function ShareStatusBadge(): null {
  return null;
}

export const useMandates = notBuilt("useMandates");

export const useShareStatus = notBuilt("useShareStatus");
