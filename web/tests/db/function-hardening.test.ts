import { describe, expect, it } from "vitest";
import { adminClient } from "./helpers";

// The only security definer functions a signed-in client may call. Everything else is called by
// the server with the admin client.
const CLIENT_CALLABLE = ["claim_invite", "create_trip", "is_trip_member", "is_trip_organizer"];

async function audit() {
  const { data, error } = await adminClient().rpc("audit_definer_functions");
  if (error) throw error;
  return data as { name: string; search_path_pinned: boolean; client_can_execute: boolean }[];
}

describe("function hardening", () => {
  it("every security definer function in public pins search_path", async () => {
    const functions = await audit();
    expect(functions.map((f) => f.name)).toEqual(expect.arrayContaining(["apply_plan", "handle_new_user", "is_trip_member"]));
    expect(functions.filter((f) => !f.search_path_pinned).map((f) => f.name)).toEqual([]);
  });

  it("only claim_invite, create_trip, is_trip_member, and is_trip_organizer are executable by clients", async () => {
    const executable = (await audit()).filter((f) => f.client_can_execute).map((f) => f.name);
    expect(executable.filter((name) => !CLIENT_CALLABLE.includes(name))).toEqual([]);
  });
});
