"use client";

import type { ErrorCard as ErrorCardPayload } from "@agp/shared";
import { CircleAlert } from "lucide-react";
import { CardFrame } from "./card-frame";

export interface ErrorCardProps {
  payload: ErrorCardPayload;
  timestamp: string;
  /** Re-sends the triggering message. Without it, there's no Try again button. */
  onRetry?: () => void;
  retryPending?: boolean;
}

/** Written when a tool or run fails, so the chat always shows what happened. */
export function ErrorCard({ payload, timestamp, onRetry, retryPending }: ErrorCardProps) {
  return (
    <CardFrame
      icon={CircleAlert}
      title="Something went wrong"
      status={{ tone: "danger", label: payload.retryable ? "Can retry" : "Failed" }}
      actor="system"
      timestamp={timestamp}
      state="error"
      errorMessage={payload.message}
      actions={
        payload.retryable && onRetry ? [{ label: "Try again", onPress: onRetry, pending: retryPending }] : undefined
      }
    />
  );
}
