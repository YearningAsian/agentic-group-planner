import { describe, expect, it, vi } from "vitest";
import { toToolError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import type { RunContext } from "../define-tool";
import { rememberPreferenceTool } from "./tool";

const person = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const tripId = "00000000-0000-4000-8000-0000000000f0";

type Pref = { dietary: string[]; interests: string[]; notes: unknown[] };
type Constraint = { dietary: string[]; interests: string[] } | null;

function fakeAdmin(opts: {
  profileId?: string | null;
  status?: string;
  prefs?: Pref | null;
  constraints?: Constraint;
}) {
  let prefs: Pref | null = opts.prefs === undefined ? null : opts.prefs === null ? null : { ...opts.prefs, notes: [...opts.prefs.notes] };
  let constraints = opts.constraints === undefined ? null : opts.constraints;
  const upsert = vi.fn(async (row: Pref & { profile_id: string }) => {
    prefs = { dietary: row.dietary, interests: row.interests, notes: row.notes as unknown[] };
    return { error: null };
  });
  const updateConstraints = vi.fn(async (row: { dietary: string[]; interests: string[]; set_by_member_id: string }) => {
    constraints = { dietary: row.dietary, interests: row.interests };
    return { error: null };
  });
  const insertConstraints = vi.fn(async (row: { dietary: string[]; interests: string[] }) => {
    constraints = { dietary: row.dietary, interests: row.interests };
    return { error: null };
  });

  const from = (table: string) => {
    if (table === "trip_members") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  profile_id: opts.profileId !== undefined ? opts.profileId : person(2),
                  status: opts.status ?? "joined",
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "person_preferences") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: prefs, error: null }),
          }),
        }),
        upsert,
      };
    }
    if (table === "member_constraints") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: constraints, error: null }),
          }),
        }),
        update: (row: { dietary: string[]; interests: string[]; set_by_member_id?: string }) => ({
          eq: async () => updateConstraints(row as { dietary: string[]; interests: string[]; set_by_member_id: string }),
        }),
        insert: insertConstraints,
      };
    }
    throw new Error(`unexpected table ${table}`);
  };

  return {
    admin: { from } as unknown as AdminClient,
    upsert,
    updateConstraints,
    insertConstraints,
    getPrefs: () => prefs,
    getConstraints: () => constraints,
  };
}

function setup(opts: Parameters<typeof fakeAdmin>[0] = {}) {
  const fake = fakeAdmin(opts);
  const ctx: RunContext = {
    tripId,
    runId: "00000000-0000-4000-8000-0000000000f1",
    toolCallId: "call_1",
    requesterMemberId: person(2),
    actorMemberId: person(2),
    handles: { M2: person(2) },
    admin: fake.admin,
  };
  const call = (input: unknown) =>
    rememberPreferenceTool
      .handler(rememberPreferenceTool.input.parse(input), ctx)
      .catch((error: unknown) => ({ ok: false as const, error: toToolError(error) }));
  return { ...fake, call, ctx };
}

describe("remember_preference tool", () => {
  it("saves diet, interest, and a note on the requester's row, and merges into this trip's constraints", async () => {
    const { call, upsert, insertConstraints, getConstraints } = setup({ prefs: null, constraints: null });
    const result = await call({ dietary: ["vegetarian"], interests: ["art"], note: "hates early starts" });
    expect(result).toMatchObject({
      ok: true,
      summary: expect.stringMatching(/diet vegetarian.*likes art.*note "hates early starts"/),
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: person(2),
        dietary: ["vegetarian"],
        interests: ["art"],
        notes: [expect.objectContaining({ text: "hates early starts", trip_id: tripId })],
      }),
      { onConflict: "profile_id" },
    );
    expect(insertConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ dietary: ["vegetarian"], interests: ["art"], member_id: person(2) }),
    );
    expect(getConstraints()).toEqual({ dietary: ["vegetarian"], interests: ["art"] });
  });

  it("unions with what was already remembered and with this trip's constraints", async () => {
    const { call, upsert, updateConstraints } = setup({
      prefs: { dietary: ["nut_free"], interests: ["parks"], notes: [{ text: "old", at: "2026-01-01T00:00:00Z" }] },
      constraints: { dietary: ["gluten_free"], interests: ["food"] },
    });
    await call({ dietary: ["vegetarian"], interests: ["art"] });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        dietary: ["nut_free", "vegetarian"],
        interests: ["art", "parks"],
        notes: [{ text: "old", at: "2026-01-01T00:00:00Z" }],
      }),
      { onConflict: "profile_id" },
    );
    expect(updateConstraints).toHaveBeenCalledWith({
      dietary: ["gluten_free", "vegetarian"],
      interests: ["art", "food"],
      set_by_member_id: person(2),
    });
  });

  it("a note alone does not rewrite this trip's constraints", async () => {
    const { call, insertConstraints, updateConstraints } = setup({ prefs: null, constraints: null });
    await call({ note: "walks slowly" });
    expect(insertConstraints).not.toHaveBeenCalled();
    expect(updateConstraints).not.toHaveBeenCalled();
  });

  it("refuses a server-started run and a member without a profile", async () => {
    const noRequester = setup();
    noRequester.ctx.requesterMemberId = null;
    await expect(
      rememberPreferenceTool.handler(rememberPreferenceTool.input.parse({ note: "x" }), noRequester.ctx),
    ).rejects.toMatchObject({ code: "not_permitted" });

    const { call } = setup({ profileId: null, status: "joined" });
    expect((await call({ note: "x" })).error).toMatchObject({ code: "not_permitted" });
  });
});
