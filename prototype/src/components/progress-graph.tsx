"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { destinationById, findFlight, findStay } from "@/lib/data";
import { formatRange, initials, money, nightsBetween } from "@/lib/format";
import { useTrip, type Member } from "@/lib/trip-context";
import { ScreenHeader } from "@/components/chrome";
import { cn } from "@/lib/cn";

type NodeStatus = "done" | "current" | "pending";

export function ProgressGraph() {
  const router = useRouter();
  const trip = useTrip();
  const { state } = trip;
  const [link, setLink] = useState("https://grouptrip.app/join/demo");
  const [copied, setCopied] = useState(false);

  const destination = destinationById(state.destinationId);
  const flight = findFlight(state.destinationId, state.lockedFlightId);
  const stay = findStay(state.destinationId, state.lockedStayId);
  const nights = nightsBetween(state.startDate, state.endDate);
  const inviteReached = Boolean(flight && stay);

  useEffect(() => {
    setLink(`${window.location.origin}/itinerary`);
  }, []);

  useEffect(() => {
    if (!inviteReached || state.didSimulateJoin) return;
    const timeout = window.setTimeout(() => trip.markFirstPendingJoined(), 1600);
    return () => window.clearTimeout(timeout);
  }, [inviteReached, state.didSimulateJoin, trip]);

  const nodes: {
    id: "flight" | "hotel" | "invite";
    title: string;
    status: NodeStatus;
    summary: string;
    editHref?: string;
  }[] = [
    {
      id: "flight",
      title: "Flight",
      status: flight ? "done" : "current",
      summary: flight ? `${flight.airline} · ${money(flight.price)}` : "Choose a flight to lock in",
      editHref: "/plan#flights",
    },
    {
      id: "hotel",
      title: "Hotel",
      status: !flight ? "pending" : stay ? "done" : "current",
      summary: stay ? `${stay.name} · ${money(stay.price)} / night` : "Choose a stay to lock in",
      editHref: "/plan#stays",
    },
    {
      id: "invite",
      title: "Invite People",
      status: !inviteReached ? "pending" : state.inviteShared ? "done" : "current",
      summary: state.inviteShared ? "Link shared" : "Send the link to anyone still pending",
    },
  ];

  const currentId = nodes.find((node) => node.status === "current")?.id ?? "invite";

  async function copyLink() {
    // Show the confirmation even if the clipboard prompt never settles.
    const write = navigator.clipboard?.writeText(link).catch(() => undefined);
    trip.markInviteShared();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    await write;
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: destination ? `Join the ${destination.label} trip` : "Join the trip",
          url: link,
        });
        trip.markInviteShared();
        return;
      } catch {
        // Cancelled shares fall through to copy.
      }
    }
    await copyLink();
  }

  return (
    <main className="min-h-dvh bg-white">
      <ScreenHeader
        current="/progress"
        title="Trip progress"
        subtitle={
          destination
            ? `${destination.label} · ${formatRange(state.startDate, state.endDate)}`
            : "Finish the questionnaire to fill this in"
        }
      />
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ol className="max-w-xl">
          {nodes.map((node, index) => {
            const expanded = node.id === currentId || (node.id === "invite" && node.status === "done");
            const dimmed = node.status === "pending";
            return (
              <li
                key={node.id}
                aria-current={node.status === "current" ? "step" : undefined}
                className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3", dimmed && "opacity-40")}
              >
                <div className="relative flex justify-center">
                  <span
                    className={cn(
                      "z-10 mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold",
                      node.status === "done" && "bg-ink text-white",
                      node.status === "current" && "bg-white text-accent ring-2 ring-accent",
                      node.status === "pending" && "bg-bg-muted text-muted ring-1 ring-line",
                    )}
                  >
                    {node.status === "done" ? (
                      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                        <path
                          d="M4.5 10.5 8 14l7.5-8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </span>
                  {index < nodes.length - 1 ? (
                    <span
                      className={cn(
                        "absolute top-10 bottom-0 w-px",
                        node.status === "done" ? "bg-ink" : "bg-line",
                      )}
                    />
                  ) : null}
                </div>
                <div className={cn("pb-8", expanded && "pb-10")}>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[20px] font-semibold tracking-tight">{node.title}</h2>
                    <StatusLabel status={node.status} />
                  </div>
                  {node.status === "done" && node.editHref ? (
                    <button
                      type="button"
                      onClick={() => router.push(node.editHref!)}
                      className="mt-1 text-left"
                    >
                      <p className="text-[15px] text-ink">{node.summary}</p>
                      <span className="mt-1 inline-block text-[14px] font-semibold underline">Edit</span>
                    </button>
                  ) : (
                    <p className="mt-1 text-[15px] text-muted">{node.summary}</p>
                  )}

                  {expanded && node.id === "flight" && node.status === "current" ? (
                    <button
                      type="button"
                      onClick={() => router.push("/plan#flights")}
                      className="mt-4 h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white"
                    >
                      Browse flights
                    </button>
                  ) : null}
                  {expanded && node.id === "hotel" && node.status === "current" ? (
                    <button
                      type="button"
                      onClick={() => router.push("/plan#stays")}
                      className="mt-4 h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white"
                    >
                      Browse stays
                    </button>
                  ) : null}
                  {expanded && node.id === "invite" && inviteReached ? (
                    <InviteSheet
                      link={link}
                      copied={copied}
                      members={state.members}
                      justJoinedName={state.justJoinedName}
                      onCopy={() => void copyLink()}
                      onShare={() => void shareLink()}
                      onItinerary={() => {
                        trip.markInviteShared();
                        router.push("/itinerary");
                      }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <aside className="h-fit overflow-hidden rounded-[24px] bg-bg-muted shadow-[var(--shadow)] lg:sticky lg:top-36">
          {destination ? (
            <img src={destination.photos[0]} alt="" className="aspect-[16/10] w-full object-cover" />
          ) : null}
          <div className="p-4">
            <p className="text-[13px] font-semibold text-muted">This trip</p>
            <p className="mt-1 text-[18px] font-semibold">{destination?.label ?? "No destination yet"}</p>
            <p className="text-[14px] text-muted">{destination?.blurb}</p>
            {flight && stay ? (
              <p className="mt-3 text-[14px] font-semibold">
                {money(flight.price + stay.price * nights)} per person
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function StatusLabel({ status }: { status: NodeStatus }) {
  const label = status === "done" ? "Done" : status === "current" ? "In progress" : "Up next";
  return <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{label}</span>;
}

function InviteSheet({
  link,
  copied,
  members,
  justJoinedName,
  onCopy,
  onShare,
  onItinerary,
}: {
  link: string;
  copied: boolean;
  members: Member[];
  justJoinedName: string | null;
  onCopy: () => void;
  onShare: () => void;
  onItinerary: () => void;
}) {
  const joined = members.filter((member) => member.joined);
  const pending = members.filter((member) => !member.joined);
  return (
    <div className="rise mt-4 rounded-[20px] bg-bg-muted p-4 shadow-[var(--shadow)]">
      <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Share</p>
      <h3 className="mt-1 text-[18px] font-semibold">Invite link</h3>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          aria-label="Invite link"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-[14px]"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={onCopy} className="h-12 rounded-full bg-accent px-5 text-[14px] font-semibold text-white">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button type="button" onClick={onShare} className="mt-2 h-11 text-[14px] font-semibold underline">
        Share another way
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? "Invite link copied." : ""}
        {justJoinedName ? `${justJoinedName} joined the trip.` : ""}
      </p>
      {justJoinedName ? <p className="mt-2 text-[14px] font-medium text-ink">{justJoinedName} just joined.</p> : null}

      <h4 className="mt-5 text-[15px] font-semibold">Joined · {joined.length}</h4>
      <ul className="mt-2">
        {joined.map((member) => (
          <MemberRow key={member.id} member={member} />
        ))}
      </ul>
      <h4 className="mt-4 text-[15px] font-semibold">Still pending · {pending.length}</h4>
      <ul className="mt-2">
        {pending.length === 0 ? (
          <li className="text-[14px] text-muted">Everyone&rsquo;s in.</li>
        ) : (
          pending.map((member) => <MemberRow key={member.id} member={member} />)
        )}
      </ul>
      <button
        type="button"
        onClick={onItinerary}
        className="mt-5 h-12 w-full rounded-full bg-ink text-[15px] font-semibold text-white"
      >
        See the itinerary
      </button>
    </div>
  );
}

function MemberRow({ member }: { member: Member }) {
  const pending = !member.joined;
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-semibold",
          pending ? "border border-dashed border-[#b0b0b0] bg-white text-muted" : "bg-ink text-white",
        )}
        aria-hidden
      >
        {pending ? "?" : initials(member.name)}
      </span>
      <div>
        <p className="text-[15px] font-semibold">{member.name.trim() || "Hasn't joined"}</p>
        <p className="text-[13px] text-muted">{pending ? "Pending" : "Joined"}</p>
      </div>
    </li>
  );
}
