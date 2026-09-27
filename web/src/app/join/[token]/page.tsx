import { previewInvite } from "@/features/invite/server";
import { ClaimButton } from "./claim-button";

/** The invite token is only for joining; the trip page itself stays behind membership. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvite(token);

  if (preview.status !== "open") {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="font-display text-3xl text-ink">{preview.status === "used" ? "This invite was already used" : "Invite not found"}</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-sm text-muted">You&rsquo;re invited as {preview.lane.display_name}</p>
      <h1 className="mt-3 font-display text-4xl text-ink">{preview.trip.title}</h1>
      <p className="mt-2 text-muted">{preview.trip.trip_date}</p>
      <ul className="my-8 space-y-3">
        {preview.lane.stops.map((stop, index) => (
          <li key={`${stop.starts}-${index}`} className="rounded-xl border border-line p-4">
            <span className="font-semibold">{stop.label}</span>
            <span className="ml-3 text-sm text-muted">{stop.starts}–{stop.ends}</span>
            {stop.place_name && <p className="mt-1 text-sm text-muted">{stop.place_name}</p>}
          </li>
        ))}
      </ul>
      <ClaimButton token={token} />
    </main>
  );
}
