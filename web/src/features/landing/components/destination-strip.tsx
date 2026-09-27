import Image from "next/image";
import { DESTINATIONS } from "../copy";
import { Reveal } from "./reveal";

export function DestinationStrip() {
  return (
    <section className="bg-ink px-5 py-16 text-paper sm:px-8 sm:py-20" aria-labelledby="destinations-heading">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 id="destinations-heading" className="font-display text-[1.85rem] font-semibold tracking-tight sm:text-[2.1rem]">
            Places the group might go
          </h2>
          <p className="mt-2 max-w-lg text-[15px] text-paper/75 text-pretty">
            Atmosphere only — no prices, no claims. Just the feeling of the trip you’re planning.
          </p>
        </Reveal>
        <ul
          tabIndex={0}
          aria-label="Destination photos"
          className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 outline-none focus-visible:ring-2 focus-visible:ring-paper/40 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {DESTINATIONS.map((place, index) => (
            <Reveal key={place.src} delayMs={index * 40} className="w-[78%] shrink-0 snap-center sm:w-[46%] lg:w-[31%]">
              <li className="overflow-hidden rounded-[16px]">
                <div className="relative aspect-[5/4]">
                  <Image src={place.src} alt={place.alt} fill sizes="(min-width: 1024px) 30vw, 80vw" className="object-cover" />
                </div>
                <p className="bg-ink px-1 pt-3 text-[14px] font-medium text-paper/90">{place.caption}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
