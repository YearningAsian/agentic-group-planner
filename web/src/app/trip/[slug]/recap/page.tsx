import Link from "next/link";
import { visibleTripBySlug } from "@/lib/trips/visible-trip";

/** The recap shares the same member-only lookup and 404 behavior as the trip page. */
export default async function RecapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await visibleTripBySlug(slug);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href={`/trip/${trip.slug}`} className="text-accent underline underline-offset-4">Back to trip</Link>
      <h1 className="mt-6 font-display text-4xl text-ink">{trip.title} recap</h1>
    </main>
  );
}
