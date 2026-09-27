"use client";

import { useState } from "react";
import { formatMoney } from "@/features/trip-draft/format";
import type { CancellationPoint, StayAccommodation, StayRates, StayReview, StayRoom } from "@/lib/providers/stays/types";

export function StayListing({
  stay,
  reviews,
  rates,
  datesLabel,
  nights,
  adults,
}: {
  stay: StayAccommodation;
  reviews: StayReview[];
  rates: StayRates | null;
  datesLabel: string | null;
  nights: number | null;
  adults: number | null;
}) {
  const [showPhotos, setShowPhotos] = useState(false);
  const [showAmenities, setShowAmenities] = useState(false);
  const location = [stay.address.lineOne, stay.address.cityName, stay.address.region].filter(Boolean).join(", ");
  const property = [stay.brandName, stay.chainName].filter(Boolean).join(" · ");
  const highlights = stay.amenities.slice(0, 3);
  const visibleAmenities = showAmenities ? stay.amenities : stay.amenities.slice(0, 8);
  const score = stay.guestScore == null ? null : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(stay.guestScore);
  const beds = bedSummary(rates?.rooms ?? []);
  const nightly = nightlyLabel(rates, nights);
  const total = amountLabel(rates?.totalAmount ?? null, rates?.currency ?? null, 2);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
      <PhotoGrid name={stay.name} photos={stay.photos.map((photo) => photo.url)} expanded={showPhotos} onToggle={() => setShowPhotos((open) => !open)} />

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h1 className="font-display text-[2rem] leading-[1.1] font-medium tracking-[-0.03em] text-balance">{stay.name}</h1>
          <p className="mt-2 text-[15px] text-ink">
            {[location, score ? `${score} guest rating` : null, stay.reviewCount != null ? `${stay.reviewCount} reviews` : null, stay.starRating != null ? `${stay.starRating}-star hotel` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {beds || adults ? (
            <p className="mt-1 text-[15px] text-muted">
              {[adults ? `${adults} ${adults === 1 ? "adult" : "adults"}` : null, beds].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {stay.checkInAfter || stay.checkOutBefore ? (
            <p className="mt-1 text-[14px] text-muted">
              {[stay.checkInAfter ? `Check-in after ${stay.checkInAfter}` : null, stay.checkOutBefore ? `Checkout before ${stay.checkOutBefore}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {property ? <p className="mt-4 text-[15px] font-semibold">{property}</p> : null}
          {stay.description ? <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink">{stay.description}</p> : null}
          {highlights.length > 0 ? (
            <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-[15px] text-ink">
              {highlights.map((item) => (
                <li key={item.type || item.description}>{item.description}</li>
              ))}
            </ul>
          ) : null}

          {stay.amenities.length > 0 ? (
            <section className="mt-10 border-t border-line pt-8">
              <h2 className="text-[20px] font-semibold">Amenities</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {visibleAmenities.map((item) => (
                  <li key={item.type || item.description} className="text-[15px]">
                    {item.description}
                  </li>
                ))}
              </ul>
              {stay.amenities.length > 8 ? (
                <button
                  type="button"
                  onClick={() => setShowAmenities((open) => !open)}
                  className="mt-4 h-11 rounded-lg border border-ink px-4 text-[14px] font-semibold"
                >
                  {showAmenities ? "Show fewer" : `Show all ${stay.amenities.length} amenities`}
                </button>
              ) : null}
            </section>
          ) : null}

          {rates && rates.rooms.length > 0 ? (
            <section className="mt-10 border-t border-line pt-8">
              <h2 className="text-[20px] font-semibold">Rooms</h2>
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {rates.rooms.slice(0, 6).map((room) => (
                  <li key={`${room.name}-${room.rateName ?? ""}`} className="flex items-start justify-between gap-4 py-4">
                    <div>
                      <p className="font-semibold">{room.name}</p>
                      <p className="mt-1 text-[14px] text-muted">
                        {[bedSummary([room]), room.boardType ? room.boardType.replaceAll("_", " ") : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {room.totalAmount && room.currency ? (
                      <p className="shrink-0 text-[15px] font-semibold tabular-nums">{amountLabel(room.totalAmount, room.currency, 0)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {score || reviews.length > 0 ? (
            <section className="mt-10 border-t border-line pt-8">
              <h2 className="text-[20px] font-semibold">{score ? `${score} guest rating` : "Reviews"}</h2>
              {stay.reviewCount != null ? <p className="mt-1 text-[14px] text-muted">{stay.reviewCount} reviews</p> : null}
              {reviews.length > 0 ? (
                <ul className="mt-5 grid gap-5 sm:grid-cols-2">
                  {reviews.map((review) => (
                    <li key={`${review.reviewerName}-${review.createdAt}-${review.text.slice(0, 24)}`}>
                      <p className="text-[14px] font-semibold">
                        {review.reviewerName}
                        {review.score != null ? <span className="ml-2 font-medium text-muted">{review.score.toFixed(1)}</span> : null}
                      </p>
                      {review.createdAt ? <p className="text-[13px] text-muted">{review.createdAt}</p> : null}
                      <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line">{review.text}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow)] lg:sticky lg:top-6">
          {nightly ? (
            <p className="text-[22px] font-semibold tabular-nums">
              {nightly} <span className="text-[15px] font-medium text-muted">/ night</span>
            </p>
          ) : (
            <p className="text-[16px] font-semibold">{datesLabel ? "No rate for these dates." : "Add trip dates to see a price."}</p>
          )}
          {total ? <p className="mt-1 text-[14px] text-muted">{total} total</p> : null}
          <div className="mt-4 rounded-xl border border-line px-4 py-3 text-[14px]">
            <p className="font-semibold">{datesLabel ?? "Dates not set"}</p>
            {adults ? <p className="mt-1 text-muted">{adults === 1 ? "1 adult" : `${adults} adults`}</p> : null}
          </div>
          {rates ? <p className="mt-3 text-[13px] leading-relaxed text-muted">{cancellationCopy(rates)}</p> : null}
          <button type="button" className="mt-4 h-12 w-full rounded-lg bg-accent text-[16px] font-semibold text-white">
            Reserve
          </button>
          <p className="mt-3 text-center text-[12.5px] text-muted">Booking isn’t connected yet.</p>
        </aside>
      </div>
    </main>
  );
}

function PhotoGrid({
  name,
  photos,
  expanded,
  onToggle,
}: {
  name: string;
  photos: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (photos.length === 0) {
    return <div className="flex h-64 items-center justify-center rounded-2xl bg-bg-muted text-muted">{name}</div>;
  }
  if (!expanded && photos.length === 1) {
    return <img src={photos[0]} alt={name} className="h-[420px] w-full rounded-xl object-cover" />;
  }
  const visible = expanded ? photos : photos.slice(0, 5);
  return (
    <div className="relative">
      {expanded ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {visible.map((url, index) => (
            <img key={`${url}-${index}`} src={url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:h-[420px] md:grid-cols-4 md:grid-rows-2">
          <img src={visible[0]} alt={name} className="h-72 w-full rounded-xl object-cover md:col-span-2 md:row-span-2 md:h-full" />
          {visible.slice(1).map((url, index) => (
            <img key={`${url}-${index}`} src={url} alt="" className="hidden h-full w-full rounded-xl object-cover md:block" />
          ))}
        </div>
      )}
      {photos.length > 1 ? (
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-4 bottom-4 h-10 rounded-lg border border-ink bg-white px-4 text-[14px] font-semibold"
        >
          {expanded ? "Show fewer photos" : "Show all photos"}
        </button>
      ) : null}
    </div>
  );
}

function bedSummary(rooms: StayRoom[]): string | null {
  const parts = rooms.flatMap((room) =>
    room.beds.map((bed) => `${bed.count} ${bed.type} ${bed.count === 1 ? "bed" : "beds"}`),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function amountLabel(amount: string | null, currency: string | null, digits: number): string | null {
  if (!amount || !currency) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return formatMoney(value, currency, digits);
}

function nightlyLabel(rates: StayRates | null, nights: number | null): string | null {
  if (!rates?.totalAmount || !rates.currency || !nights) return null;
  const total = Number(rates.totalAmount);
  if (!Number.isFinite(total)) return null;
  return formatMoney(total / nights, rates.currency);
}

function cancellationCopy(rates: StayRates): string {
  const timeline = rates.rooms.flatMap((room) => room.cancellationTimeline);
  if (timeline.length === 0) return "Non-refundable";
  const point = timeline[0] as CancellationPoint;
  const when = new Date(point.before);
  const label = Number.isNaN(when.getTime())
    ? point.before
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(when);
  if (rates.totalAmount && point.refundAmount === rates.totalAmount) return `Full refund before ${label}`;
  const refund = amountLabel(point.refundAmount, point.currency, 2);
  return refund ? `Refund of ${refund} before ${label}` : `Refund before ${label}`;
}
