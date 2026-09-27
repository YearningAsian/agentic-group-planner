import { HOW_IT_WORKS } from "../copy";
import { Reveal } from "./reveal";

/** Tiny live-looking UI chips for each step — not icons. */
function StepPreview({ step }: { step: (typeof HOW_IT_WORKS)[number]["title"] }) {
  if (step === "Chat") {
    return (
      <div className="rounded-[14px] border border-line bg-paper p-3 shadow-[0_8px_24px_-18px_rgb(11_27_43/0.35)]">
        <div className="flex gap-2">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-lagoon text-[10px] font-bold text-paper">
            A
          </span>
          <p className="rounded-[12px] bg-mist px-3 py-2 text-[12.5px] leading-snug text-ink">
            Three lunch options scored for the group — vegetarian-safe first.
          </p>
        </div>
      </div>
    );
  }
  if (step === "Itinerary") {
    return (
      <div className="space-y-1.5 rounded-[14px] border border-line bg-paper p-3 shadow-[0_8px_24px_-18px_rgb(11_27_43/0.35)]">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-lane-1/15 px-2 text-[12px] font-semibold text-ink">
          <span className="size-2 rounded-full bg-lane-1" /> Person 1 · market
        </div>
        <div className="flex h-8 items-center gap-2 rounded-lg bg-lane-2/15 px-2 text-[12px] font-semibold text-ink">
          <span className="size-2 rounded-full bg-lane-2" /> Person 2 · museum
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-[14px] border border-line bg-paper p-3 shadow-[0_8px_24px_-18px_rgb(11_27_43/0.35)]">
      <button
        type="button"
        tabIndex={-1}
        className="pointer-events-none h-10 w-full rounded-full bg-ink text-[13px] font-semibold text-paper"
      >
        Approve my share · $42
      </button>
      <p className="mt-2 text-center text-[11px] font-medium text-muted">Agent proposed · You approve</p>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-sand px-5 py-20 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 className="font-display max-w-xl text-[2rem] font-semibold tracking-tight text-ink text-balance sm:text-[2.35rem]">
            How it works
          </h2>
          <p className="mt-3 max-w-lg text-base text-muted text-pretty">
            Chat, a lane for each person, then approvals that feel as calm as a banking app.
          </p>
        </Reveal>
        <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
          {HOW_IT_WORKS.map((step, index) => (
            <Reveal key={step.title} delayMs={index * 40}>
              <li className="flex flex-col gap-4">
                <StepPreview step={step.title} />
                <div>
                  <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted text-pretty">{step.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
