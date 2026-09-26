"use client";

import { cn } from "cn";
import { Loader2, type LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

export type CardTone = "neutral" | "info" | "success" | "warning" | "danger";
export type CardState = "ready" | "loading" | "error" | "unavailable";

export interface CardAction {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  pending?: boolean;
  disabled?: boolean;
}

export interface CardFrameProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  status?: { tone: CardTone; label: string };
  actor: "agent" | "system";
  timestamp: string;
  state: CardState;
  /** Shown in the error state. */
  errorMessage?: string;
  actions?: CardAction[];
  children?: ReactNode;
}

const TONE_CLASS: Record<CardTone, string> = {
  neutral: "bg-surface-2 text-text-muted",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function ActionButton({ action }: { action: CardAction }) {
  const inert = action.pending || action.disabled;
  return (
    <button
      type="button"
      aria-busy={action.pending || undefined}
      aria-disabled={inert || undefined}
      onClick={inert ? undefined : action.onPress}
      className={cn(
        "touch-target focus-ring inline-flex items-center justify-center gap-2 rounded-control px-4 text-sm font-medium",
        "transition-[background-color,transform,opacity] duration-150 ease-out active:scale-[0.98]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        action.variant === "secondary"
          ? "border border-border bg-surface text-text hover:bg-surface-2"
          : "bg-primary text-primary-contrast hover:bg-primary/90",
      )}
    >
      {action.pending ? <Loader2 data-slot="spinner" aria-hidden className="size-4 animate-spin" /> : null}
      <span>{action.label}</span>
    </button>
  );
}

/**
 * The shared frame for every chat card: header (icon, title, status, actor, time), body, and
 * actions. The body is replaced by a skeleton while loading, and by a notice when the card's data
 * no longer exists.
 */
export function CardFrame(props: CardFrameProps) {
  const titleId = useId();
  const Icon = props.icon;
  return (
    <article
      aria-labelledby={titleId}
      aria-busy={props.state === "loading" || undefined}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-text shadow-sm"
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-2 text-primary">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="text-base font-semibold leading-snug">
              {props.title}
            </h3>
            {props.status ? (
              <span className={cn("rounded-pill px-2 py-0.5 text-xs font-medium", TONE_CLASS[props.status.tone])}>
                {props.status.label}
              </span>
            ) : null}
          </div>
          {props.subtitle ? <p className="text-sm text-text-muted">{props.subtitle}</p> : null}
        </div>
        <p className="shrink-0 text-xs text-text-muted">
          {props.actor === "agent" ? "Agent" : "Trip"} ·{" "}
          <time dateTime={props.timestamp}>{timeFormat.format(new Date(props.timestamp))}</time>
        </p>
      </header>

      {props.state === "unavailable" ? (
        <p className="text-sm text-text-muted">This card is out of date.</p>
      ) : props.state === "loading" ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="h-4 w-3/4 animate-pulse rounded-control bg-surface-2" />
          <div className="h-4 w-1/2 animate-pulse rounded-control bg-surface-2" />
        </div>
      ) : (
        <>
          {props.state === "error" && props.errorMessage ? (
            <p role="alert" className="text-sm text-danger">
              {props.errorMessage}
            </p>
          ) : null}
          {props.children}
        </>
      )}

      {props.actions && props.actions.length > 0 && props.state !== "unavailable" ? (
        <div className="flex flex-wrap gap-2">
          {props.actions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
