"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export function OptionCard({
  image,
  title,
  subtitle,
  meta,
  priceLabel,
  priceHint,
  selected,
  compared,
  compareIndex,
  overBudget,
  onSelect,
}: {
  image: string;
  title: string;
  subtitle: string;
  meta: string;
  priceLabel: string;
  priceHint: string;
  selected: boolean;
  compared: boolean;
  compareIndex: number | null;
  overBudget: boolean;
  onSelect: () => void;
}) {
  const marked = selected || compared;
  return (
    <article
      className={cn(
        "relative rounded-[20px] bg-white text-left shadow-[var(--shadow)] transition duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[var(--shadow-lift)]",
        selected ? "ring-2 ring-ink" : compared ? "ring-2 ring-accent" : "ring-1 ring-line-soft",
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-[20px] bg-bg-muted">
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 33vw, 80vw" className="object-cover" />
        {overBudget ? (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-semibold text-ink">
            Above budget
          </span>
        ) : null}
        {marked ? (
          <span className="pointer-events-none absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[14px] font-semibold text-ink shadow-[var(--shadow)]">
            {selected ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                <path
                  d="M4.5 10.5 8 14l7.5-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              compareIndex
            )}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <p className="shrink-0 text-[16px] font-semibold">{priceLabel}</p>
        </div>
        <p className="text-[14px] text-muted">{subtitle}</p>
        <p className="text-[14px] text-muted">{meta}</p>
        <p className="text-[12px] text-muted">{priceHint}</p>
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected || compared}
        aria-label={`${selected ? "Locked in" : compared ? "Selected to compare" : "Select"} ${title}, ${priceLabel}. ${subtitle}. ${meta}.`}
        className="absolute inset-0 z-10 rounded-[20px]"
      />
    </article>
  );
}
