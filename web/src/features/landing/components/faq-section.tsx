"use client";

import { useId, useState } from "react";
import { FAQ } from "../copy";
import { Reveal } from "./reveal";
import { cn } from "cn";

export function FaqSection() {
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 bg-sand px-5 py-20 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <h2 className="font-display text-[2rem] font-semibold tracking-tight text-ink sm:text-[2.25rem]">FAQ</h2>
          <p className="mt-3 text-base text-muted">Straight answers from how the product works today.</p>
        </Reveal>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {FAQ.map((item, index) => {
            const panelId = `${baseId}-panel-${index}`;
            const buttonId = `${baseId}-button-${index}`;
            const isOpen = open === index;
            return (
              <Reveal key={item.q} delayMs={index * 40}>
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[1.05rem] font-semibold text-ink"
                    onClick={() => setOpen(isOpen ? null : index)}
                  >
                    {item.q}
                    <span
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-lg leading-none transition-transform duration-200",
                        isOpen && "rotate-45",
                      )}
                      aria-hidden
                    >
                      +
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="pb-5 text-[15px] leading-relaxed text-muted text-pretty"
                >
                  {item.a}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
