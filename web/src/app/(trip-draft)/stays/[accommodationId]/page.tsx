import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StayListing } from "@/features/trip-draft/components/stay-listing";
import { formatRange, nightsBetween, validRange } from "@/features/trip-draft/format";
import { getStaysProvider } from "@/lib/providers/stays";

export const metadata: Metadata = { title: "Stay" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StayPage({
  params,
  searchParams,
}: {
  params: Promise<{ accommodationId: string }>;
  searchParams: Promise<{ checkIn?: string; checkOut?: string; adults?: string }>;
}) {
  const { accommodationId } = await params;
  const query = await searchParams;
  const checkIn = query.checkIn ?? "";
  const checkOut = query.checkOut ?? "";
  const datesReady = DATE.test(checkIn) && DATE.test(checkOut) && validRange(checkIn, checkOut);
  const parsedAdults = Number(query.adults ?? "");
  const adults = Number.isInteger(parsedAdults) && parsedAdults >= 1 && parsedAdults <= 9 ? parsedAdults : null;

  const provider = getStaysProvider();
  const stay = await provider.getAccommodation(decodeURIComponent(accommodationId));
  if (!stay) notFound();

  const [reviews, rates] = await Promise.all([
    provider.getReviews(stay.id).catch(() => []),
    datesReady
      ? provider
          .getRates({
            accommodationId: stay.id,
            checkIn,
            checkOut,
            adults: adults ?? 1,
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <StayListing
      stay={stay}
      reviews={reviews}
      rates={rates}
      datesLabel={datesReady ? formatRange(checkIn, checkOut) : null}
      nights={datesReady ? nightsBetween(checkIn, checkOut) : null}
      adults={adults}
    />
  );
}
