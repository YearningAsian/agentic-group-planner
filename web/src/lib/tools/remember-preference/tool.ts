import "server-only";
import { type Dietary, RememberPreferenceInput } from "@agp/shared";
import type { Json } from "@agp/shared/db";
import { AppError } from "@/lib/reliability";
import { defineTool, type RunContext } from "../define-tool";

const MAX_NOTES = 30;

type PrefRow = { dietary: string[]; interests: string[]; notes: Json };

function noteList(notes: Json): { text: string; trip_id?: string; at: string }[] {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((n) => {
    const text = (n as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.trim() === "") return [];
    const trip = (n as { trip_id?: unknown }).trip_id;
    const at = (n as { at?: unknown }).at;
    return [
      {
        text: text.trim(),
        ...(typeof trip === "string" ? { trip_id: trip } : {}),
        at: typeof at === "string" ? at : new Date(0).toISOString(),
      },
    ];
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function profileId(ctx: RunContext): Promise<string> {
  if (!ctx.requesterMemberId) {
    throw new AppError("not_permitted", "Only a member can save preferences about themselves.", { retryable: false });
  }
  const { data, error } = await ctx.admin
    .from("trip_members")
    .select("profile_id, status")
    .eq("id", ctx.requesterMemberId)
    .eq("trip_id", ctx.tripId)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read who asked.", { retryable: true, cause: error });
  if (!data || data.status !== "joined" || !data.profile_id) {
    throw new AppError("not_permitted", "Only a joined member can save preferences about themselves.", { retryable: false });
  }
  return data.profile_id;
}

async function loadOrEmpty(ctx: RunContext, profileId: string): Promise<PrefRow> {
  const { data, error } = await ctx.admin
    .from("person_preferences")
    .select("dietary, interests, notes")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read remembered preferences.", { retryable: true, cause: error });
  return data ?? { dietary: [], interests: [], notes: [] };
}

async function syncTripConstraints(
  ctx: RunContext,
  dietary: string[],
  interests: string[],
): Promise<void> {
  const { data: existing, error: readError } = await ctx.admin
    .from("member_constraints")
    .select("dietary, interests")
    .eq("member_id", ctx.requesterMemberId!)
    .maybeSingle();
  if (readError) throw new AppError("internal", "Couldn't read this trip's constraints.", { retryable: true, cause: readError });

  const row = {
    trip_id: ctx.tripId,
    member_id: ctx.requesterMemberId!,
    dietary: uniqueSorted([...(existing?.dietary ?? []), ...dietary]),
    interests: uniqueSorted([...(existing?.interests ?? []), ...interests]),
    set_by_member_id: ctx.requesterMemberId!,
  };
  const { error } = existing
    ? await ctx.admin.from("member_constraints").update({ dietary: row.dietary, interests: row.interests, set_by_member_id: row.set_by_member_id }).eq("member_id", row.member_id)
    : await ctx.admin.from("member_constraints").insert(row);
  if (error) throw new AppError("internal", "Couldn't update this trip's constraints.", { retryable: true, cause: error });
}

/**
 * remember_preference (plan AI-217): saves what the requester said about themselves onto their
 * `person_preferences` row and merges dietary/interests into this trip's `member_constraints`.
 * No card — memory is silent; the next run's context quotes it.
 */
export const rememberPreferenceTool = defineTool({
  name: "remember_preference",
  description:
    "Remember something the person who asked said about themselves (a diet, an interest, or a short note like \"hates early starts\"). Never call this for another member. It persists across trips and seeds this trip's constraints.",
  input: RememberPreferenceInput,
  handler: async (input, ctx) => {
    const id = await profileId(ctx);
    const current = await loadOrEmpty(ctx, id);
    const dietary = uniqueSorted([...(current.dietary as Dietary[]), ...(input.dietary ?? [])]);
    const interests = uniqueSorted([...current.interests, ...(input.interests ?? [])]);
    const notes = noteList(current.notes);
    if (input.note) {
      notes.push({ text: input.note, trip_id: ctx.tripId, at: new Date().toISOString() });
      while (notes.length > MAX_NOTES) notes.shift();
    }

    const { error } = await ctx.admin.from("person_preferences").upsert(
      { profile_id: id, dietary, interests, notes: notes as unknown as Json },
      { onConflict: "profile_id" },
    );
    if (error) throw new AppError("internal", "Couldn't save the preference.", { retryable: true, cause: error });

    if ((input.dietary?.length ?? 0) > 0 || (input.interests?.length ?? 0) > 0) {
      await syncTripConstraints(ctx, input.dietary ?? [], input.interests ?? []);
    }

    const parts = [
      ...(input.dietary?.length ? [`diet ${input.dietary.join(", ")}`] : []),
      ...(input.interests?.length ? [`likes ${input.interests.join(", ")}`] : []),
      ...(input.note ? [`note "${input.note}"`] : []),
    ];
    return { ok: true, summary: `Remembered ${parts.join("; ")} for the person who asked.` };
  },
});
