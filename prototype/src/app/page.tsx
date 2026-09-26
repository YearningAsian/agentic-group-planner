import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Start" };

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-white">
      <div className="mx-auto grid min-h-dvh max-w-6xl lg:grid-cols-2">
        <section className="flex flex-col justify-center px-6 py-12 sm:px-10">
          <p className="text-[13px] font-semibold tracking-tight">Group Trip Agent</p>
          <h1 className="mt-3 text-[40px] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[52px]">
            Plan the trip before everyone&rsquo;s in the chat.
          </h1>
          <p className="mt-4 max-w-md text-[17px] text-muted">
            A few questions, a flight, a stay, then a link for the people who haven&rsquo;t joined yet.
          </p>
          <Link
            href="/onboarding"
            className="mt-8 inline-flex h-12 w-fit items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white hover:bg-[#e00b41]"
          >
            Start the questionnaire
          </Link>
        </section>
        <div className="relative min-h-[280px]">
          <img
            src="https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1600&q=80"
            alt="A yellow tram on a steep Lisbon street"
            className="h-full w-full object-cover lg:absolute lg:inset-0"
          />
        </div>
      </div>
    </main>
  );
}
