"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { PRODUCT_NAME } from "../copy";
import { cn } from "cn";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
] as const;

export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.72);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,color] duration-200",
        solid || open
          ? "bg-sand/95 text-ink shadow-[0_1px_0_rgb(11_27_43/0.08)] backdrop-blur-md"
          : "bg-transparent text-paper",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:h-16 sm:px-8">
        <a href="#top" className="inline-flex min-h-11 items-center gap-2.5 font-semibold tracking-tight">
          <span
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md text-sm font-bold",
              solid || open ? "bg-ink text-paper" : "bg-paper/15 text-paper ring-1 ring-paper/30",
            )}
          >
            G
          </span>
          <span className="text-[15px]">{PRODUCT_NAME}</span>
        </a>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex h-11 items-center rounded-full px-3 text-sm font-medium opacity-90 hover:opacity-100"
            >
              {link.label}
            </a>
          ))}
          {signedIn ? (
            <Link
              href="/trips"
              className="ml-2 inline-flex h-11 items-center rounded-full bg-coral px-4 text-sm font-semibold text-ink hover:bg-coral/90"
            >
              Open my trips
            </Link>
          ) : (
            <>
              <Link href="/login" className="inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold">
                Log in
              </Link>
              <Link
                href="/signup"
                className="ml-1 inline-flex h-11 items-center rounded-full bg-coral px-4 text-sm font-semibold text-ink hover:bg-coral/90"
              >
                Create account
              </Link>
            </>
          )}
        </nav>

        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <div
          id="mobile-nav"
          className="border-t border-line bg-sand px-5 py-4 text-ink md:hidden"
          role="dialog"
          aria-label="Menu"
        >
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center text-base font-medium"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {signedIn ? (
                <Link
                  href="/trips"
                  className="inline-flex h-11 items-center justify-center rounded-full bg-coral text-sm font-semibold text-ink"
                  onClick={() => setOpen(false)}
                >
                  Open my trips
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="inline-flex h-11 items-center justify-center rounded-full border border-line text-sm font-semibold"
                    onClick={() => setOpen(false)}
                  >
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    className="inline-flex h-11 items-center justify-center rounded-full bg-coral text-sm font-semibold text-ink"
                    onClick={() => setOpen(false)}
                  >
                    Create account
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
