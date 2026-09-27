import Link from "next/link";
import { visibleTripBySlug } from "@/lib/trips/visible-trip";

/** A member-only entry point addressed by the trip's public slug. */
export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await visibleTripBySlug(slug);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-muted">{trip.city} · {trip.trip_date}</p>
      <h1 className="mt-3 font-display text-4xl text-ink">{trip.title}</h1>
      <Link href={`/trip/${trip.slug}/recap`} className="mt-8 inline-block text-accent underline underline-offset-4">
        View recap
      </Link>
    </main>
  );
}
