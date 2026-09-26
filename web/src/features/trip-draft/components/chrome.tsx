/**
 * `ScreenHeader`, `PrimaryButton`, and `Chip` for `/plan`, `/progress`, `/itinerary`, and the questionnaire.
 * Sidebar links live in `app-shell.tsx`.
 */
import type { ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/onboarding", label: "Questions" },
  { href: "/plan", label: "Picks" },
  { href: "/current", label: "Current trip" },
  { href: "/progress", label: "Progress" },
  { href: "/itinerary", label: "Itinerary" },
];

export function ScreenHeader({
  title,
  subtitle,
  current,
}: {
  title: string;
  subtitle?: string;
  current: "/plan" | "/current" | "/progress" | "/itinerary";
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-white/90 px-5 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-[13px] font-semibold tracking-tight text-ink">
            Group Trip Agent
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.href === current ? "page" : undefined}
                className={cn(link.href === current ? "text-ink" : "text-muted hover:text-ink")}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div>
          <h1 className="font-display text-[1.85rem] leading-[1.1] font-medium tracking-[-0.03em] text-balance">{title}</h1>
          {subtitle ? <p className="mt-1 text-[15px] text-muted">{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}

export function PrimaryButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint disabled:active:scale-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Chip({
  pressed,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cn(
        "h-11 rounded-full px-4 text-[15px] font-medium transition",
        pressed ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line hover:ring-ink",
      )}
    >
      {children}
    </button>
  );
}
