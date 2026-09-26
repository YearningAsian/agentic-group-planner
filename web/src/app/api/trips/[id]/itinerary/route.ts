import { itinerary } from "@agp/shared";
import { z } from "zod";
import { buildItineraryExport, toIcs } from "@/features/itinerary/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/** A file name from the trip and member, like saturday-in-atlanta-person-2.ics. */
function fileName(title: string, member: string): string {
  const slug = `${title}-${member}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "itinerary"}.ics`;
}

/**
 * A member's schedule as a calendar file (design §5.5): one event per attended item, rendered from
 * live rows with the caller's session, so a non-member gets 403 and nothing is stored.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return badRequest("The trip ID must be a UUID.");
  const url = new URL(request.url);
  const query = itinerary.ItineraryQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    const issue = query.error.issues[0];
    return badRequest(`${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`);
  }

  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to download your itinerary.");
    const schedule = await buildItineraryExport(client, { tripId: id, memberId: query.data.member });
    return new Response(toIcs(schedule), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName(schedule.trip.title, schedule.member.display_name)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
