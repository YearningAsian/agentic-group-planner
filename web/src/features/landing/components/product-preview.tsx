"use client";

/**
 * Static product preview for the hero: agent message, three scored options, approval chip.
 * Non-interactive and aria-hidden so it never competes with real controls.
 */
export function ProductPreview() {
  const options = [
    { title: "Morning market walk", meta: "Together · 9:30", score: "92" },
    { title: "Tile museum", meta: "Split · Person 2 & 3", score: "88" },
    { title: "River tram loop", meta: "Together · afternoon", score: "85" },
  ] as const;

  return (
    <div
      className="pointer-events-none select-none rounded-[18px] border border-white/20 bg-paper/95 p-4 shadow-[0_18px_50px_-24px_rgb(11_27_43/0.55)] backdrop-blur-sm"
      aria-hidden
      tabIndex={-1}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-lagoon text-xs font-bold text-paper">
          A
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">Agent</p>
          <p className="mt-1 text-[13.5px] leading-snug text-muted">
            Here are three ways to spend tomorrow. Pick together, then each lane stays clear.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {options.map((option, index) => (
          <li
            key={option.title}
            className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-mist/50 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">
                <span className="mr-1.5 text-muted">{index + 1}.</span>
                {option.title}
              </p>
              <p className="truncate text-[12px] text-muted">{option.meta}</p>
            </div>
            <span className="shrink-0 rounded-full bg-lagoon/15 px-2 py-0.5 text-[11px] font-bold text-lagoon-ink">
              {option.score}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper">3 of 4 approved</span>
        <span className="text-[12px] font-medium text-muted">Agent proposed · You approve</span>
      </div>
    </div>
  );
}
