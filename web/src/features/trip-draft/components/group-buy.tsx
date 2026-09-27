"use client";

import { useEffect, useState } from "react";
import type { ChosenFlight, ChosenStay } from "@/features/trip-draft/chosen-travel";
import { formatMoney } from "@/features/trip-draft/format";
import { quoteShares, type QuotedShare } from "@/features/trip-draft/group-share";
import type { Member } from "@/features/trip-draft/trip-context";

const LINKS_KEY = "group-buy-links";
const PAID_KEY = "group-buy-paid";

type StoredLink = { memberId: string; url: string; totalCents: number };

type Choice = { member: Member; index: number };

function centsLabel(cents: number, currency: string): string {
  return formatMoney(cents / 100, currency, cents % 100 === 0 ? 0 : 2);
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
}: {
  destinationId: string | null;
  startDate: string;
  endDate: string;
  members: Choice[];
  chosenFlight: ChosenFlight | null;
  chosenStay: ChosenStay | null;
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
  const [links, setLinks] = useState<StoredLink[]>(() =>
    typeof window === "undefined"
      ? []
      : readJson<StoredLink[]>(LINKS_KEY, []).filter((link) => typeof link?.url === "string"),
  );
  const [paid, setPaid] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readJson<string[]>(PAID_KEY, []).filter((id) => typeof id === "string"),
  );
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    let cancelled = false;
    void fetch(`/api/group-checkout?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) => (response.ok ? ((await response.json()) as { paid?: boolean; memberId?: string | null }) : null))
      .then((body) => {
        if (cancelled || !body?.paid || !body.memberId) return;
        setPaid((current) => {
          if (current.includes(body.memberId!)) return current;
          const next = [...current, body.memberId!];
          sessionStorage.setItem(PAID_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const allConfirmed = quote.ok && shares.every((share) => confirmed[share.memberId] === share.totalCents);
  const activeLinks = links.filter((link) => shares.some((share) => share.memberId === link.memberId && share.totalCents === link.totalCents));

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

  return (
    <section className="mb-4 rounded-[20px] border border-line bg-surface px-5 py-[18px]" style={{ boxShadow: "var(--shadow)" }}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold">Group buy</h2>
        <span className="text-[12px] text-ink-faint">Each person pays their share</span>
      </div>
      {shares.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {shares.map((share) => (
            <ShareRow
              key={share.memberId}
              share={share}
              confirmed={confirmed[share.memberId] === share.totalCents}
              paid={paid.includes(share.memberId)}
              link={activeLinks.find((item) => item.memberId === share.memberId)?.url}
              onConfirm={() => setConfirmed((current) => ({ ...current, [share.memberId]: share.totalCents }))}
            />
          ))}
        </ul>
      ) : null}
      {!quote.ok ? <p className="mt-3 text-[13px] text-[#c62828]">{quote.message}</p> : null}
      {quote.ok ? (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <p className="text-[14px] font-bold tabular-nums">Group total {centsLabel(quote.totalCents, quote.currency)}</p>
          <button
            type="button"
            disabled={!allConfirmed || opening}
            onClick={() => void startCheckout()}
            className="h-11 shrink-0 rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {opening ? "Opening checkout…" : "Checkout"}
          </button>
        </div>
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
  paid,
  link,
  onConfirm,
}: {
  share: QuotedShare;
  confirmed: boolean;
  paid: boolean;
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
      {paid ? (
        <span className="shrink-0 rounded-full bg-good-tint px-2 py-0.5 text-[11px] font-bold text-success">Paid</span>
      ) : link ? (
        <a
          href={link}
          className="inline-flex h-11 shrink-0 items-center rounded-lg bg-ink px-3 text-[12px] font-bold text-white hover:bg-[#302a22]"
        >
          Pay {amount}
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
