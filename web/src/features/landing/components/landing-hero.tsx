"use client";

import Link from "next/link";
import { useRef } from "react";
import { HERO } from "../copy";
import { ProductPreview } from "./product-preview";
import { usePrefersReducedMotion } from "./reveal";

export function LandingHero({ signedIn, demoMode }: { signedIn: boolean; demoMode: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  return (
    <section id="top" className="relative isolate min-h-[100svh] overflow-hidden bg-ink text-paper">
      {!reduceMotion ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          poster="/media/hero-poster.webp"
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          aria-hidden
          onLoadedData={(event) => {
            void event.currentTarget.play().catch(() => undefined);
          }}
        >
          <source src="/media/hero-loop.mp4" type="video/mp4" />
        </video>
      ) : (
        // Poster-only when motion is reduced so LCP stays on a still image.
        // eslint-disable-next-line @next/next/no-img-element -- still image LCP path under reduced motion
        <img
          src="/media/hero-poster.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
        />
      )}

      <div
        className="absolute inset-0 bg-gradient-to-r from-[color-mix(in_oklab,var(--ink)_72%,transparent)] via-[color-mix(in_oklab,var(--ink)_48%,transparent)] to-[color-mix(in_oklab,var(--ink)_28%,transparent)]"
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-36 pt-28 sm:px-8 sm:pb-40 lg:justify-center lg:pb-24 lg:pt-24">
        <div className="max-w-xl">
          <p className="font-display text-[1.35rem] font-medium tracking-tight text-paper/90 sm:text-[1.5rem]">
            Group Trip Agent
          </p>
          <h1 className="font-display mt-3 text-[2.35rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[3.15rem]">
            {HERO.headline}
          </h1>
          <p className="mt-4 max-w-[36rem] text-[1.05rem] leading-relaxed text-paper/85 text-pretty sm:text-[1.125rem]">
            {HERO.subhead}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {signedIn ? (
              <Link
                href="/trips"
                className="inline-flex h-12 items-center rounded-full bg-coral px-6 text-[15px] font-semibold text-ink hover:bg-coral/90"
              >
                {HERO.ctaSignedIn}
              </Link>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="inline-flex h-12 items-center rounded-full bg-coral px-6 text-[15px] font-semibold text-ink hover:bg-coral/90"
                >
                  {HERO.ctaPrimary}
                </Link>
                {demoMode ? (
                  <Link
                    href="/login#demo"
                    className="inline-flex h-12 items-center rounded-full border border-paper/40 bg-paper/10 px-6 text-[15px] font-semibold text-paper backdrop-blur-sm hover:bg-paper/20"
                  >
                    {HERO.ctaDemo}
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-[28%] px-5 sm:px-8 lg:translate-y-[22%]">
        <div className="mx-auto max-w-md lg:ml-auto lg:mr-8 lg:max-w-sm">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}
