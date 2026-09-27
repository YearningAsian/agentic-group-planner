// Client-safe entry point. Other code imports this feature only through this file or server.ts.
// Stubs until the feature's owner builds them.

export { DemoLoginPicker } from "./components/demo-login-picker";
export { InstantLoginCards } from "./components/instant-login-cards";
export { DEMO_PEOPLE, type DemoPersonKey, isDemoPersonKey } from "./demo-people";

export function DevToolbar(): null {
  return null;
}
