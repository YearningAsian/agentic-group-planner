import "server-only";
import { notBuilt } from "@/lib/not-built";

export type * from "./types";

// Picks the real or mock implementation from its env flag. Stub until the provider's owner builds it.
export const getGroundingProvider = notBuilt("getGroundingProvider");
