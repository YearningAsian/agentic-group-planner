// Client-safe entry point. Other code imports this feature only through this file or server.ts.
// Stubs until the feature's owner builds them.
import { notBuilt } from "@/lib/not-built";

export function ChatView(): null {
  return null;
}

export const useMessages = notBuilt("useMessages");
