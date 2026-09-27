import Link from "next/link";
import { FINAL_CTA, PRODUCT_NAME } from "../copy";
import { Reveal } from "./reveal";

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-28">
      <div
        className="absolute inset-0 -z-10 bg-[url('/media/water-texture.webp')] bg-cover bg-center"
        aria-hidden
      />
      <div className="absolute inset-0 -z-10 bg-[color-mix(in_oklab,var(--sand)_55%,transparent)]" aria-hidden />
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-[2.15rem] font-semibold tracking-tight text-ink text-balance sm:text-[2.5rem]">
          {FINAL_CTA.title}
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base text-muted text-pretty">{FINAL_CTA.body}</p>
        <div className="mt-8 flex justify-center">
          <Link
            href={signedIn ? "/trips" : "/signup"}
            className="inline-flex h-12 items-center rounded-full bg-coral px-7 text-[15px] font-semibold text-ink shadow-[0_12px_28px_-16px_rgb(11_27_43/0.45)] hover:bg-coral/90"
          >
            {signedIn ? "Open my trips" : FINAL_CTA.cta}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-sand px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink">{PRODUCT_NAME}</p>
        <p className="text-sm text-muted">
          <a
            href="https://github.com/YearningAsian/agentic-group-planner"
            className="font-medium text-lagoon-ink underline-offset-2 hover:underline"
          >
            GitHub
          </a>
          <span className="mx-2 text-line">·</span>
          <span>{year}</span>
        </p>
      </div>
    </footer>
  );
}
