import type { Metadata } from "next";
import { HERO, LandingPage, PRODUCT_NAME } from "@/features/landing";
import { getServerClient } from "@/lib/supabase/server";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: { absolute: PRODUCT_NAME },
  description: HERO.subhead,
  alternates: { canonical: "/" },
  openGraph: {
    title: PRODUCT_NAME,
    description: HERO.subhead,
    url: siteUrl,
    siteName: PRODUCT_NAME,
    type: "website",
    images: [
      {
        url: "/media/coast-road.webp",
        width: 2400,
        height: 1600,
        alt: "A winding coastal road above a turquoise sea at golden hour.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_NAME,
    description: HERO.subhead,
    images: ["/media/coast-road.webp"],
  },
};

export default async function MarketingHomePage() {
  const client = await getServerClient();
  const { data } = await client.auth.getUser();
  const signedIn = Boolean(data.user);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  return <LandingPage signedIn={signedIn} demoMode={demoMode} />;
}
