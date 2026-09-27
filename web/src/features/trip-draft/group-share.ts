import type { ChosenFlight, ChosenStay } from "@/features/trip-draft/chosen-travel";
import { dollarsToCents, nightsBetween } from "@/features/trip-draft/format";
import { findFlight, findStay } from "@/features/trip-draft/fixtures";

export type GroupShareMember = {
  id: string;
  name: string;
  flightId: string;
  stayId: string;
};

export type GroupShareInput = {
  destinationId: string | null;
  startDate: string;
  endDate: string;
  members: GroupShareMember[];
  /** Live lock. Used only when a member's pick is not in the fixture catalog. */
  chosenFlight: ChosenFlight | null;
  chosenStay: ChosenStay | null;
};

export type QuotedShare = {
  memberId: string;
  name: string;
  flightLabel: string;
  stayLabel: string;
  nights: number;
  flightCents: number;
  stayCents: number;
  totalCents: number;
  currency: string;
};

export type QuoteFailure = {
  memberId: string;
  name: string;
  message: string;
};

export type GroupQuote =
  | { ok: true; shares: QuotedShare[]; totalCents: number; currency: string; nights: number }
  | { ok: false; shares: QuotedShare[]; failures: QuoteFailure[]; message: string };

type Priced = { label: string; dollars: number; currency: string };

/**
 * Each joined traveler's flight plus hotel nights.
 * Fixture ids are priced from the catalog. A live lock is used only when the pick is not a fixture,
 * so the browser cannot replace a catalog fare with its own amount.
 */
export function quoteShares(input: GroupShareInput): GroupQuote {
  const nights = nightsBetween(input.startDate, input.endDate);
  const shares: QuotedShare[] = [];
  const failures: QuoteFailure[] = [];

  for (const member of input.members) {
    const name = member.name.trim() || "Traveler";
    const flight = priceFlight(input.destinationId, member.flightId, input.chosenFlight);
    const stay = priceStay(input.destinationId, member.stayId, input.chosenStay, nights);
    if ("message" in flight || "message" in stay) {
      failures.push({
        memberId: member.id,
        name,
        message: "message" in flight ? flight.message : (stay as { message: string }).message,
      });
      continue;
    }
    if (flight.currency !== stay.currency) {
      failures.push({
        memberId: member.id,
        name,
        message: `${name}'s flight and hotel are in different currencies.`,
      });
      continue;
    }
    const flightCents = dollarsToCents(flight.dollars);
    const stayCents = dollarsToCents(stay.dollars);
    const totalCents = flightCents + stayCents;
    if (totalCents < 50) {
      failures.push({ memberId: member.id, name, message: `${name}'s share is below the minimum charge.` });
      continue;
    }
    shares.push({
      memberId: member.id,
      name,
      flightLabel: flight.label,
      stayLabel: stay.label,
      nights,
      flightCents,
      stayCents,
      totalCents,
      currency: flight.currency,
    });
  }

  if (failures.length > 0) {
    return { ok: false, shares, failures, message: failures[0]?.message ?? "These shares can't be checked out." };
  }
  const currency = shares[0]?.currency;
  if (!currency || shares.some((share) => share.currency !== currency)) {
    return {
      ok: false,
      shares,
      failures: [],
      message: "Everyone has to pay in the same currency.",
    };
  }
  return {
    ok: true,
    shares,
    totalCents: shares.reduce((sum, share) => sum + share.totalCents, 0),
    currency,
    nights,
  };
}

function priceFlight(
  destinationId: string | null,
  flightId: string,
  chosen: ChosenFlight | null,
): Priced | { message: string } {
  const fixture = findFlight(destinationId, flightId);
  if (fixture) {
    return {
      label: `${fixture.airline} · ${fixture.from} → ${fixture.to}`,
      dollars: fixture.price,
      currency: "USD",
    };
  }
  if (chosen && chosen.id === flightId && chosen.price > 0 && /^[A-Za-z]{3}$/.test(chosen.currency)) {
    return {
      label: `${chosen.airline} · ${chosen.origin} → ${chosen.destination}`,
      dollars: chosen.price,
      currency: chosen.currency.toUpperCase(),
    };
  }
  return { message: "That flight isn't priced on this trip." };
}

function priceStay(
  destinationId: string | null,
  stayId: string,
  chosen: ChosenStay | null,
  nights: number,
): Priced | { message: string } {
  const fixture = findStay(destinationId, stayId);
  if (fixture) {
    return {
      label: `${fixture.name} · ${nights} ${nights === 1 ? "night" : "nights"}`,
      dollars: fixture.price * nights,
      currency: "USD",
    };
  }
  const nightly = chosen?.nightlyAmount;
  if (
    chosen &&
    chosen.id === stayId &&
    nightly != null &&
    nightly > 0 &&
    chosen.currency &&
    /^[A-Za-z]{3}$/.test(chosen.currency)
  ) {
    return {
      label: `${chosen.name} · ${nights} ${nights === 1 ? "night" : "nights"}`,
      dollars: nightly * nights,
      currency: chosen.currency.toUpperCase(),
    };
  }
  return { message: "That hotel isn't priced on this trip." };
}
