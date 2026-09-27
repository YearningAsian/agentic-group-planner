import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { BrandLogo } from "@/components/brand-logo";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  sideImage: { src: string; alt: string; caption: string };
  footer?: ReactNode;
};

/** Split-screen auth layout: form on the left, travel photo on the right (desktop). */
export function AuthShell({ title, subtitle, children, sideImage, footer }: AuthShellProps) {
  return (
    <div
      className={`${jakarta.variable} ${fraunces.variable} marketing-surface relative min-h-dvh font-sans antialiased`}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[url('/media/water-texture.webp')] bg-cover bg-center opacity-[0.22] md:hidden"
        aria-hidden
      />
      <div className="mx-auto grid min-h-dvh w-full md:grid-cols-[minmax(0,26rem)_1fr] lg:grid-cols-[26rem_1fr]">
        <main className="flex flex-col justify-center px-5 py-10 sm:px-8 md:max-w-[26rem]">
          <Link href="/" className="mb-10 inline-flex w-fit">
            <BrandLogo layout="lockup" priority className="h-28" />
          </Link>
          <h1 className="font-display text-[1.85rem] font-semibold tracking-tight text-ink text-balance sm:text-[2.05rem]">
            {title}
          </h1>
          {subtitle ? <p className="mt-2 text-[15px] leading-relaxed text-muted text-pretty">{subtitle}</p> : null}
          <div className="mt-8 space-y-6">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </main>
        <aside className="relative hidden min-h-dvh overflow-hidden md:block" aria-label="Travel photo">
          <Image
            src={sideImage.src}
            alt={sideImage.alt}
            fill
            sizes="(min-width: 768px) 55vw, 0px"
            className="object-cover"
            priority
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[color-mix(in_oklab,var(--ink)_58%,transparent)] via-[color-mix(in_oklab,var(--ink)_12%,transparent)] to-transparent"
            aria-hidden
          />
          <p className="absolute right-8 bottom-8 left-8 max-w-sm font-display text-lg font-medium tracking-tight text-paper/95 text-pretty">
            {sideImage.caption}
          </p>
        </aside>
      </div>
    </div>
  );
}
