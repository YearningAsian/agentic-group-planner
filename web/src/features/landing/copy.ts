/**
 * Landing copy and helpers. Every marketed string lives here so the copy test can scan it.
 * Advertise only features that ship today; money copy is "Agent proposed · You approve".
 */

export const PRODUCT_NAME = "Group Trip Agent";

export const HERO = {
  headline: "Plan it together. Pay your part.",
  subhead:
    "An AI travel agent in your group chat that finds the options, builds the itinerary, and lets everyone approve and pay their own share.",
  ctaPrimary: "Create account",
  ctaDemo: "Try the demo trip",
  ctaSignedIn: "Open my trips",
} as const;

export const HOW_IT_WORKS = [
  {
    title: "Chat",
    body: "Ask the agent in the group chat. It scores options and brings back clear choices to vote on.",
  },
  {
    title: "Itinerary",
    body: "Everyone gets their own lane on a shared day plan — including a friend who hasn’t joined yet.",
  },
  {
    title: "Approve and pay",
    body: "Agent proposed · You approve. Each person reviews their share, fees, and cap, then pays their part.",
  },
] as const;

export const FEATURES = [
  {
    id: "plan-together",
    title: "Plan together",
    body: "One chat for the whole group. The agent finds scored options; you vote and comment until the day feels right.",
    image: "/media/friends-planning.webp",
    alt: "Four friends planning a trip over a paper map and phones at an outdoor café.",
    imageSide: "right" as const,
  },
  {
    id: "lanes",
    title: "Everyone gets their own lane",
    body: "A shared itinerary with a lane per person, so you can see who’s free for lunch and who needs a quieter morning.",
    image: "/media/coast-road.webp",
    alt: "A winding two-lane coastal road hugging rugged cliffs above a calm turquoise sea during a golden sunset.",
    imageSide: "left" as const,
  },
  {
    id: "split",
    title: "Split without the spreadsheet",
    body: "Group approval shows each person’s itemized share, fees, and cap. Agent proposed · You approve — the agent never pays.",
    image: "/media/beach-cabana.webp",
    alt: "A thatched beach cabana with white curtains on pale sand beside turquoise water at sunset.",
    imageSide: "right" as const,
  },
  {
    id: "remember",
    title: "Remember the trip",
    body: "After the trip, open the gallery and a short recap so the group keeps the moments you planned for.",
    image: "/media/japan-lantern-street.webp",
    alt: "A lantern-lit wooden street at dusk with a bicycle parked against a traditional building.",
    imageSide: "left" as const,
  },
] as const;

export const DESTINATIONS = [
  {
    src: "/media/coast-road.webp",
    caption: "Coast road at golden hour",
    alt: "A winding coastal road above a turquoise sea at sunset.",
  },
  {
    src: "/media/lisbon-tram.webp",
    caption: "Lisbon tram and river",
    alt: "A yellow tram on a steep Lisbon street with the Tagus River behind.",
  },
  {
    src: "/media/beach-cabana.webp",
    caption: "Beach cabana at dusk",
    alt: "A thatched cabana on a tropical beach at sunset.",
  },
  {
    src: "/media/japan-lantern-street.webp",
    caption: "Lantern street at dusk",
    alt: "Paper lanterns lighting a narrow wooden street at twilight.",
  },
] as const;

export const FAQ = [
  {
    q: "Who pays?",
    a: "Each person approves and pays their own share. The agent proposes the split and never charges a card.",
  },
  {
    q: "What if someone doesn’t approve?",
    a: "The booking waits. Shares stay pending until everyone who needs to approve has done so, or the organizer cancels.",
  },
  {
    q: "Can I plan for a friend who hasn’t signed up?",
    a: "Yes. Add a placeholder lane, keep planning, and send an invite when they’re ready to claim it.",
  },
  {
    q: "Is my card charged right away?",
    a: "No. Approvals place a hold for your share up to a cap. Capture happens only after the group’s approvals are in.",
  },
  {
    q: "What can the agent do?",
    a: "It chats with the group, scores options, builds the itinerary, and proposes purchases with clear fees. The agent never pays, invents amounts, or books without your approval.",
  },
  {
    q: "What about fees?",
    a: "Every approval card itemizes your share and fees before you confirm. Nothing hidden in the chat.",
  },
] as const;

export const FINAL_CTA = {
  title: "Ready to plan the next one?",
  body: "Create an account, invite the group, and let the agent handle the options while everyone keeps control of their share.",
  cta: "Create account",
} as const;

/** Words and phrases the landing must not use (dropped or never-shipped claims). */
export const BANNED_LANDING_TERMS = [
  "restaurant call",
  "voice call",
  "elevenlabs",
  "flight deal",
  "from $",
  "pricing",
  "testimonial",
  "trusted by",
  "users worldwide",
] as const;

/** True when copy wrongly claims the agent pays, charges, or books. */
export function pairsAgentWithPaid(text: string): boolean {
  if (/\bagent\b.{0,50}\bnever\s+(pays?|charges?|books?)\b/i.test(text)) return false;
  if (/\bagent\b.{0,50}\bcan'?t\s+(pay|charge|book)\b/i.test(text)) return false;
  return /\bagent\b.{0,40}\b(pays?|paid|charges?|charged|books?|booked)\b/i.test(text);
}

/** Flatten every marketed string for scanning. */
export function allLandingCopy(): string[] {
  return [
    HERO.headline,
    HERO.subhead,
    HERO.ctaPrimary,
    HERO.ctaDemo,
    HERO.ctaSignedIn,
    ...HOW_IT_WORKS.flatMap((step) => [step.title, step.body]),
    ...FEATURES.flatMap((feature) => [feature.title, feature.body]),
    ...DESTINATIONS.map((d) => d.caption),
    ...FAQ.flatMap((item) => [item.q, item.a]),
    FINAL_CTA.title,
    FINAL_CTA.body,
    FINAL_CTA.cta,
  ];
}
