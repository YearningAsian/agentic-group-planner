// Client-safe entry point. Server code imports `@/lib/supabase/server` (user session) or
// `@/lib/supabase/admin` (service role) directly; both start with `import "server-only"`.
export { type BrowserClient, getBrowserClient } from "./browser";
export { SupabaseProvider, useSupabase } from "./provider";
export { SessionGuard } from "./session-guard";
