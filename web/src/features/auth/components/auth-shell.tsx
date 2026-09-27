import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";

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
        className="pointer-events-none absolute inset-0 -z-10 bg-[url('/media/water-texture.webp')] bg-cover bg-center opacity-25 md:hidden"
        aria-hidden
      />
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl md:grid-cols-[minmax(0,420px)_1fr] lg:grid-cols-[420px_1fr]">
        <div className="flex flex-col justify-center px-5 py-10 sm:px-8">
          <Link href="/" className="mb-8 inline-flex w-fit items-center gap-2 text-ink">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-ink text-sm font-bold text-paper">
              G
            </span>
            <span className="text-sm font-bold tracking-tight">Group Trip Agent</span>
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink text-balance">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-muted text-pretty">{subtitle}</p> : null}
          <div className="mt-8 space-y-6">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </div>
        <aside className="relative hidden overflow-hidden md:block">
          <Image
            src={sideImage.src}
            alt={sideImage.alt}
            fill
            sizes="(min-width: 768px) 55vw, 0px"
            className="object-cover"
            priority={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[color-mix(in_oklab,var(--ink)_55%,transparent)] via-transparent to-transparent" />
          <p className="absolute right-6 bottom-6 left-6 text-sm font-medium text-paper/95">{sideImage.caption}</p>
        </aside>
      </div>
    </div>
  );
}
