"use client";

import { type CardPayload as CardPayloadType, CardPayload, type CardType } from "@agp/shared";
import { FileQuestion } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { CardFrame, ErrorCard } from "@/components/card-frame";
import { BookingConfirmedCard } from "@/features/booking";
import { MemberJoinedCard } from "@/features/invite";
import { PriceChangeCard } from "@/features/payments";
import { CallStatusCardView } from "./call-restaurant/card";
import { RecapCardView } from "./generate-recap/card";
import { PlanCardView } from "./plan-day/card";
import { ApprovalCardView } from "./propose-purchase/card";
import { PlaceListCardView } from "./search-places/card";
import { SummaryCardView } from "./summarize/card";
import { ItineraryChangeCardView } from "./update-item/card";

/** The message columns a card needs. */
export interface CardMessage {
  id: string;
  card_type: string | null;
  card_payload: unknown;
  created_at: string;
}

export interface CardRendererProps<T extends CardPayloadType = CardPayloadType> {
  payload: T;
  message: CardMessage;
}

type Renderers = { [K in CardType]: ComponentType<CardRendererProps<Extract<CardPayloadType, { card_type: K }>>> };

/** Every card type's renderer: the 7 tool cards and the 4 server-originated ones. */
export const cardRenderers: Renderers = {
  place_list: PlaceListCardView,
  plan: PlanCardView,
  itinerary_change: ItineraryChangeCardView,
  summary: SummaryCardView,
  approval: ApprovalCardView,
  call_status: CallStatusCardView,
  recap: RecapCardView,
  booking_confirmed: BookingConfirmedCard,
  price_change: PriceChangeCard,
  member_joined: MemberJoinedCard,
  error: ({ payload, message }) => <ErrorCard payload={payload} timestamp={message.created_at} />,
};

/**
 * Renders a card message. A payload that fails its schema, or whose type disagrees with the row,
 * renders the frame's unavailable state instead of crashing the chat.
 */
export function renderCard(message: CardMessage): ReactNode {
  const parsed = CardPayload.safeParse(message.card_payload);
  if (!parsed.success || parsed.data.card_type !== message.card_type) {
    return (
      <CardFrame
        icon={FileQuestion}
        title="Card"
        actor="system"
        timestamp={message.created_at}
        state="unavailable"
      />
    );
  }
  const Renderer = cardRenderers[parsed.data.card_type] as ComponentType<CardRendererProps>;
  return <Renderer payload={parsed.data} message={message} />;
}
