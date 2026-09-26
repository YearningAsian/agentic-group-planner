"use client";

import type { Destination } from "@/lib/data";

const PAN: Record<string, { x: number; y: number }> = {
  lisbon: { x: 18, y: -6 },
  kyoto: { x: -36, y: -4 },
  "mexico-city": { x: 28, y: 10 },
  reykjavik: { x: 10, y: -28 },
  "new-orleans": { x: 22, y: 8 },
  barcelona: { x: 8, y: -8 },
};

export function FallbackMap({
  focus,
  pinned,
  note,
}: {
  focus: Destination | null;
  pinned: boolean;
  note?: string;
}) {
  const pan = focus ? (PAN[focus.id] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const scale = pinned ? 1.45 : focus ? 1.12 : 1;

  return (
    <div className="relative h-full min-h-[220px] overflow-hidden bg-[#c5d5d0]">
      <div
        className="absolute inset-[-20%] transition-transform duration-700 ease-out motion-reduce:transition-none"
        style={{ transform: `translate(${pan.x}%, ${pan.y}%) scale(${scale})` }}
      >
        <svg className="h-full w-full" viewBox="0 0 800 480" aria-hidden>
          <rect width="800" height="480" fill="#c5d5d0" />
          <ellipse cx="180" cy="210" rx="120" ry="70" fill="#efe6d6" />
          <ellipse cx="250" cy="250" rx="70" ry="46" fill="#e7dcc8" />
          <ellipse cx="430" cy="150" rx="90" ry="48" fill="#efe6d6" />
          <ellipse cx="560" cy="190" rx="130" ry="62" fill="#e7dcc8" />
          <ellipse cx="250" cy="340" rx="80" ry="40" fill="#efe6d6" />
          <ellipse cx="620" cy="300" rx="70" ry="36" fill="#efe6d6" />
        </svg>
      </div>
      {pinned && focus ? (
        <div className="pin-pop pointer-events-none absolute left-1/2 top-[42%] flex -translate-x-1/2 -translate-y-full flex-col items-center">
          <span className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow)]">
            {focus.label}
          </span>
          <span className="-mt-1 h-3 w-3 rotate-45 bg-accent" />
        </div>
      ) : focus ? (
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink shadow-[var(--shadow)]">
          {focus.label}
        </p>
      ) : null}
      <p className="absolute bottom-3 left-3 right-3 text-[12px] leading-snug text-[#3d4a46]">
        {note ?? "Preview map. Add a real Mapbox token in .env.local to load live tiles."}
      </p>
    </div>
  );
}
