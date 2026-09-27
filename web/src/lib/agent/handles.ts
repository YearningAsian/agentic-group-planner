import { formatHandle, type HandleKind, parseHandle } from "@agp/shared";
import { AppError } from "@/lib/reliability";

/**
 * Handle → UUID for one run, e.g. `{ M1: "…", I2: "…" }`. The runner shares one table across the
 * run's tool calls, so a handle a tool adds (`addHandle`) resolves in later calls too.
 */
export type HandleTable = Record<string, string>;

export interface HandleInput {
  members: readonly { id: string; sort_order: number }[];
  items: readonly { id: string; starts_at: string; position: number; slot_key: string }[];
  options: readonly { id: string; item_id: string; rank: number; place_id: string }[];
}

export interface AssignedHandles {
  table: HandleTable;
  /** UUID → handle, for rendering rows the model will refer back to. */
  byId: Readonly<Record<string, string>>;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Assigns the run's handles in a fixed order (design §2.1): members by `sort_order`, items by
 * `starts_at` (split siblings by `position`), options by their item's order and then rank, and places
 * in the order the options first name them. The input order never matters, so the same trip state
 * always yields the same handles, which recorded runs depend on (design §7.5).
 */
export function assignHandles(input: HandleInput): AssignedHandles {
  const members = [...input.members].sort((a, b) => a.sort_order - b.sort_order || byId(a, b));
  const items = [...input.items].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.position - b.position || byId(a, b),
  );
  const itemOrder = new Map(items.map((item, i) => [item.id, i]));
  const options = input.options
    .filter((option) => itemOrder.has(option.item_id))
    .sort((a, b) => itemOrder.get(a.item_id)! - itemOrder.get(b.item_id)! || a.rank - b.rank || byId(a, b));
  const places = [...new Set(options.map((option) => option.place_id))];

  const table: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  const add = (kind: HandleKind, ids: string[]) =>
    ids.forEach((id, i) => {
      const handle = formatHandle(kind, i + 1);
      table[handle] = id;
      reverse[id] = handle;
    });
  add("M", members.map((m) => m.id));
  add("I", items.map((i) => i.id));
  add("O", options.map((o) => o.id));
  add("P", places);
  return { table, byId: reverse };
}

/**
 * Gives a row created during the run the next handle of its kind (a new option becomes O7 after
 * O1–O6), or returns the handle it already has. Tools report new handles in `ToolResult.handles`.
 */
export function addHandle(handles: HandleTable, kind: HandleKind, id: string): string {
  let last = 0;
  for (const [handle, existing] of Object.entries(handles)) {
    const parsed = parseHandle(handle);
    if (parsed?.kind !== kind) continue;
    if (existing === id) return handle;
    last = Math.max(last, parsed.index);
  }
  const handle = formatHandle(kind, last + 1);
  handles[handle] = id;
  return handle;
}

/**
 * The UUID behind a handle the model sent. An unknown handle, or one of the wrong kind, is an
 * `unknown_handle` error, which the runner returns to the model so it can correct itself.
 */
export function resolveHandle(handles: HandleTable, handle: string, kind?: HandleKind): string {
  const parsed = parseHandle(handle);
  if (kind && parsed && parsed.kind !== kind) {
    throw new AppError("unknown_handle", `${handle} isn't an ${kind} handle. Use one from the trip context.`, {
      retryable: false,
    });
  }
  const id = parsed ? handles[handle] : undefined;
  if (!id) {
    throw new AppError("unknown_handle", `There's no ${handle || "(empty)"} on this trip. Use a handle from the trip context.`, {
      retryable: false,
    });
  }
  return id;
}
