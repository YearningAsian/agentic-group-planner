import "server-only";

// The agent's entry point: routes start runs through this, never the runner's internals.
export { startAgentRun } from "./runner";
