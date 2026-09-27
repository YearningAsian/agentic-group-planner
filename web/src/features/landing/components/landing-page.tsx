import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { DestinationStrip } from "./destination-strip";
import { FaqSection } from "./faq-section";
import { FeatureBands } from "./feature-bands";
import { FinalCta, LandingFooter } from "./final-cta";
import { HowItWorks } from "./how-it-works";
import { LandingHero } from "./landing-hero";
import { LandingNav } from "./landing-nav";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export function LandingPage({ signedIn, demoMode }: { signedIn: boolean; demoMode: boolean }) {
  return (
    <div className={`${jakarta.variable} ${fraunces.variable} marketing-surface min-h-dvh antialiased`}>
      <LandingNav signedIn={signedIn} />
      <main>
        <LandingHero signedIn={signedIn} demoMode={demoMode} />
        <div className="h-28 bg-sand sm:h-32 lg:h-24" aria-hidden />
        <HowItWorks />
        <FeatureBands />
        <DestinationStrip />
        <FaqSection />
        <FinalCta signedIn={signedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}
