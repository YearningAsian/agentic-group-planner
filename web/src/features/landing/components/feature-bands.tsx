import Image from "next/image";
import { FEATURES } from "../copy";
import { Reveal } from "./reveal";
import { cn } from "cn";

function ApprovalSharePreview() {
  return (
    <div className="mt-6 max-w-sm rounded-[14px] border border-line bg-paper p-4 shadow-[0_12px_32px_-20px_rgb(11_27_43/0.4)]">
      <p className="text-[12px] font-semibold text-muted">Your share</p>
      <p className="mt-1 text-[15px] font-semibold text-ink">Day tickets · 4 people</p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Ticket</dt>
          <dd className="font-medium tabular-nums text-ink">$36.00</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Service fee</dt>
          <dd className="font-medium tabular-nums text-ink">$2.40</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1.5">
          <dt className="font-semibold text-ink">Cap</dt>
          <dd className="font-semibold tabular-nums text-ink">$42.00</dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] font-medium text-lagoon-ink">Agent proposed · You approve</p>
    </div>
  );
}

function RecapPreview() {
  return (
    <div className="mt-6 grid max-w-sm grid-cols-3 gap-2">
      {["/media/coast-road.webp", "/media/lisbon-tram.webp", "/media/beach-cabana.webp"].map((src) => (
        <div key={src} className="relative aspect-[3/4] overflow-hidden rounded-[12px]">
          <Image src={src} alt="" fill sizes="120px" className="object-cover" />
        </div>
      ))}
    </div>
  );
}

export function FeatureBands() {
  return (
    <section id="features" className="scroll-mt-20 bg-paper">
      {FEATURES.map((feature, index) => {
        const imageLeft = feature.imageSide === "left";
        return (
          <div
            key={feature.id}
            className={cn("border-t border-line", index % 2 === 0 ? "bg-paper" : "bg-sand/60")}
          >
            <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-16">
              <Reveal
                className={cn(imageLeft ? "lg:order-1" : "lg:order-2")}
                delayMs={0}
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-[18px] shadow-[0_20px_50px_-28px_rgb(11_27_43/0.45)]">
                  <Image
                    src={feature.image}
                    alt={feature.alt}
                    fill
                    sizes="(min-width: 1024px) 40vw, 100vw"
                    className="object-cover"
                  />
                </div>
              </Reveal>
              <Reveal className={cn(imageLeft ? "lg:order-2" : "lg:order-1")} delayMs={40}>
                <h2 className="font-display text-[1.85rem] font-semibold tracking-tight text-ink text-balance sm:text-[2.15rem]">
                  {feature.title}
                </h2>
                <p className="mt-4 max-w-md text-[1.05rem] leading-relaxed text-muted text-pretty">{feature.body}</p>
                {feature.id === "split" ? <ApprovalSharePreview /> : null}
                {feature.id === "remember" ? <RecapPreview /> : null}
              </Reveal>
            </div>
          </div>
        );
      })}
    </section>
  );
}
