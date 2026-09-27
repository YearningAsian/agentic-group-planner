"use client";

import { useEffect, useState } from "react";
import type { ChosenFlight, ChosenStay } from "@/features/trip-draft/chosen-travel";
import { formatMoney } from "@/features/trip-draft/format";
import { quoteShares, type QuotedShare } from "@/features/trip-draft/group-share";
import type { Member } from "@/features/trip-draft/trip-context";

const LINKS_KEY = "group-buy-holds";

type StoredLink = {
  memberId: string;
  name?: string;
  url: string | null;
  sessionId?: string | null;
  totalCents: number;
  currency?: string;
  status?: string;
};

type Choice = { member: Member; index: number };

function centsLabel(cents: number, currency: string): string {
  return formatMoney(cents / 100, currency, cents % 100 === 0 ? 0 : 2);
}

function sessionIdOf(link: StoredLink): string | null {
  if (typeof link.sessionId === "string" && /^cs_[A-Za-z0-9_]+$/.test(link.sessionId)) return link.sessionId;
  const match = link.url?.match(/cs_[A-Za-z0-9_]+/);
  return match?.[0] ?? null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function GroupBuy({
  destinationId,
  startDate,
  endDate,
  members,
  chosenFlight,
  chosenStay,
  tripId = null,
  itemId = null,
  optionId = null,
}: {
  destinationId: string | null;
  startDate: string;
  endDate: string;
  members: Choice[];
  chosenFlight: ChosenFlight | null;
  chosenStay: ChosenStay | null;
  tripId?: string | null;
  itemId?: string | null;
  optionId?: string | null;
}) {
  const quote = quoteShares({
    destinationId,
    startDate,
    endDate,
    members: members.map(({ member, index }) => ({
      id: member.id,
      name: member.name.trim() || `Person ${index + 1}`,
      flightId: member.flightId ?? "",
      stayId: member.stayId ?? "",
    })),
    chosenFlight,
    chosenStay,
  });
  const shares = quote.shares;
  const [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const [links, setLinks] = useState<StoredLink[]>([]);
  const [restored, setRestored] = useState(false);
  const [opening, setOpening] = useState(false);
  const [charging, setCharging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!restored && typeof window !== "undefined") {
    setRestored(true);
    setLinks(readJson<StoredLink[]>(LINKS_KEY, []).filter((link) => typeof link?.memberId === "string"));
  }

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    let cancelled = false;
    void fetch(`/api/group-checkout?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) =>
        response.ok ? ((await response.json()) as { state?: "paid" | "authorized" | "open"; memberId?: string | null }) : null,
      )
      .then((body) => {
        if (cancelled || !body?.memberId || (body.state !== "paid" && body.state !== "authorized")) return;
        const status = body.state === "paid" ? "captured" : "authorized";
        setLinks((current) => {
          const next = current.map((link) => (link.memberId === body.memberId ? { ...link, status } : link));
          sessionStorage.setItem(LINKS_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionKey = links
    .map((link) => sessionIdOf(link))
    .filter((id): id is string => id !== null)
    .join(",");

  const watchingHolds = links.some((link) => {
    const sessionId = sessionIdOf(link);
    return sessionId && link.status !== "captured" && link.status !== "declined" && link.status !== "failed";
  });

  useEffect(() => {
    if (!sessionKey || !watchingHolds) return;
    let cancelled = false;
    async function refresh() {
      const updates = await Promise.all(
        sessionKey.split(",").map(async (sessionId) => {
          try {
            const response = await fetch(`/api/group-checkout?session_id=${encodeURIComponent(sessionId)}`);
            if (!response.ok) return null;
            return (await response.json()) as { state?: "paid" | "authorized" | "open"; memberId?: string | null };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setLinks((current) => {
        let changed = false;
        const next = current.map((link) => {
          const hit = updates.find((item) => item?.memberId && item.memberId === link.memberId);
          if (!hit || (hit.state !== "paid" && hit.state !== "authorized")) return link;
          const status = hit.state === "paid" ? "captured" : "authorized";
          if (link.status === status) return link;
          changed = true;
          return { ...link, status };
        });
        if (!changed) return current;
        sessionStorage.setItem(LINKS_KEY, JSON.stringify(next));
        return next;
      });
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionKey, watchingHolds]);

  const allConfirmed = quote.ok && shares.every((share) => confirmed[share.memberId] === share.totalCents);
  const activeLinks = links.filter((link) => shares.some((share) => share.memberId === link.memberId && share.totalCents === link.totalCents));
  const readyToCharge =
    activeLinks.length > 0 &&
    activeLinks.every((link) => link.status === "authorized" || link.status === "captured") &&
    activeLinks.some((link) => link.status === "authorized" && sessionIdOf(link));

  async function startCheckout() {
    if (!quote.ok || !allConfirmed) return;
    setOpening(true);
    setError(null);
    try {
      const response = await fetch("/api/group-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destinationId,
          startDate,
          endDate,
          members: members.map(({ member, index }) => ({
            id: member.id,
            name: member.name.trim() || `Person ${index + 1}`,
            flightId: member.flightId ?? "",
            stayId: member.stayId ?? "",
          })),
          chosenFlight,
          chosenStay,
          ...(tripId && itemId && optionId ? { tripId, itemId, optionId } : {}),
        }),
      });
      const body = (await response.json()) as { links?: StoredLink[]; error?: { message?: string } };
      if (!response.ok || !body.links) {
        setError(body.error?.message ?? "Checkout couldn't be opened.");
        return;
      }
      setLinks(body.links);
      sessionStorage.setItem(LINKS_KEY, JSON.stringify(body.links));
    } catch {
      setError("Checkout couldn't be opened.");
    } finally {
      setOpening(false);
    }
  }

  async function chargeGroup() {
    const held = activeLinks.find((link) => link.status === "authorized" && sessionIdOf(link));
    const sessionId = held ? sessionIdOf(held) : null;
    if (!sessionId) return;
    setCharging(true);
    setError(null);
    try {
      const response = await fetch("/api/group-checkout/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = (await response.json()) as { state?: "captured" | "waiting"; error?: { message?: string } };
      if (!response.ok || body.state !== "captured") {
        setError(body.error?.message ?? "The group is still waiting on a hold.");
        return;
      }
      setLinks((current) => {
        const next = current.map((link) => (link.status === "authorized" ? { ...link, status: "captured" } : link));
        sessionStorage.setItem(LINKS_KEY, JSON.stringify(next));
        return next;
      });
    } catch {
      setError("The group charge didn't go through.");
    } finally {
      setCharging(false);
    }
  }

  return (
    <section className="mb-4 rounded-[20px] border border-line bg-surface px-5 py-[18px]" style={{ boxShadow: "var(--shadow)" }}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold">Group buy</h2>
        <span className="text-[12px] text-ink-faint">Cards stay held until you checkout for the group</span>
      </div>
      {links.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {links.map((link) => (
            <HoldRow key={link.memberId} link={link} fallbackName={shares.find((share) => share.memberId === link.memberId)?.name} />
          ))}
        </ul>
      ) : shares.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {shares.map((share) => (
            <ShareRow
              key={share.memberId}
              share={share}
              confirmed={confirmed[share.memberId] === share.totalCents}
              link={activeLinks.find((item) => item.memberId === share.memberId)?.url ?? undefined}
              onConfirm={() => setConfirmed((current) => ({ ...current, [share.memberId]: share.totalCents }))}
            />
          ))}
        </ul>
      ) : null}
      {links.some((link) => link.status === "declined" || link.status === "failed") ? (
        <p className="mt-3 text-[13px] text-ink-faint">
          Waiting on {links.filter((link) => link.status === "declined" || link.status === "failed").map((link) => link.name || "a traveler").join(", ")}
        </p>
      ) : null}
      {!quote.ok ? <p className="mt-3 text-[13px] text-[#c62828]">{quote.message}</p> : null}
      {quote.ok ? (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <p className="text-[14px] font-bold tabular-nums">Group total {centsLabel(quote.totalCents, quote.currency)}</p>
          {readyToCharge ? (
            <button
              type="button"
              disabled={charging}
              onClick={() => void chargeGroup()}
              className="h-11 shrink-0 rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {charging ? "Charging the group…" : "Checkout for the group"}
            </button>
          ) : links.length === 0 ? (
            <button
              type="button"
              disabled={!allConfirmed || opening}
              onClick={() => void startCheckout()}
              className="h-11 shrink-0 rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {opening ? "Opening checkout…" : "Checkout"}
            </button>
          ) : null}
        </div>
      ) : null}
      {readyToCharge ? (
        <p className="mt-2 text-[12.5px] text-ink-faint">Everyone's card is held. Checkout moves that money to Stripe.</p>
      ) : null}
      {quote.ok && !allConfirmed ? (
        <p className="mt-2 text-[12.5px] text-ink-faint">Everyone confirms their share, then the organizer can open checkout.</p>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-[#c62828]">{error}</p> : null}
    </section>
  );
}

function ShareRow({
  share,
  confirmed,
  link,
  onConfirm,
}: {
  share: QuotedShare;
  confirmed: boolean;
  link: string | undefined;
  onConfirm: () => void;
}) {
  const amount = centsLabel(share.totalCents, share.currency);
  return (
    <li className="flex items-center gap-3 rounded-xl bg-bg-muted px-3.5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{share.name}</span>
        <span className="mt-px block truncate text-[12px] text-muted">
          {share.flightLabel} + {share.stayLabel}
        </span>
      </span>
      <span className="shrink-0 text-[15px] font-bold tabular-nums">{amount}</span>
      {link ? (
        <a
          href={link}
          className="inline-flex h-11 shrink-0 items-center rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22]"
        >
          Authorize {amount}
        </a>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmed}
          className="h-11 shrink-0 rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-ink hover:bg-bg-muted disabled:opacity-70"
        >
          {confirmed ? "Confirmed" : "Confirm I'll pay"}
        </button>
      )}
    </li>
  );
}

function HoldRow({ link, fallbackName }: { link: StoredLink; fallbackName?: string }) {
  const currency = link.currency ?? "USD";
  const amount = centsLabel(link.totalCents, currency);
  const name = link.name || fallbackName || "Traveler";
  return (
    <li className="flex items-center gap-3 rounded-xl bg-bg-muted px-3.5 py-3">
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name}</span>
      <span className="shrink-0 text-[15px] font-bold tabular-nums">{amount}</span>
      {link.status === "captured" ? (
        <span className="shrink-0 rounded-full bg-good-tint px-2 py-0.5 text-[11px] font-bold text-success">Paid</span>
      ) : link.status === "authorized" ? (
        <span className="shrink-0 rounded-full bg-good-tint px-2 py-0.5 text-[11px] font-bold text-success">Held</span>
      ) : link.status === "declined" || link.status === "failed" ? (
        <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-ink-faint">Waiting</span>
      ) : link.url ? (
        <a
          href={link.url}
          className="inline-flex h-11 shrink-0 items-center rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22]"
        >
          Authorize {amount}
        </a>
      ) : null}
    </li>
  );
}
