import { notBuilt } from "@/lib/not-built";

export { AppError, type AppErrorCode, toHttpError, toToolError } from "./app-error";
export { isTransient, type Policy, withPolicy } from "./with-policy";

// The webhook ledger (record first, then process; design §7.2). Stubs until it's built.
export const recordWebhook = notBuilt("recordWebhook");
export const finishWebhook = notBuilt("finishWebhook");
