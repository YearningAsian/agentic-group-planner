/**
 * Which hold (one PaymentIntent) a share row belongs to. Each payer has one main hold per mandate
 * (design §4.2). When the organizer covers a share someone declined, that share gets a cover hold
 * of its own, because an authorized PaymentIntent can't grow. Keys and filters come from here, so
 * the approval, finalize, and webhook paths agree on which rows each PaymentIntent pays.
 */
export type Hold = { kind: "main" } | { kind: "cover"; shareMemberId: string };

const COVER_PREFIX = "cover:";

/** A cover row's `idempotency_key`; the row's key is how every path recognizes a cover. */
export function coverRowKey(mandateId: string, shareMemberId: string): string {
  return `${COVER_PREFIX}${mandateId}:${shareMemberId}`;
}

/**
 * What follows `pi-auth:{mandate_id}:`, `pi-capture:{mandate_id}:`, and `pi-release:{mandate_id}:`.
 * The main hold keeps design §7.1's keys; a cover hold adds the share it covers.
 */
export function holdSuffix(payerMemberId: string, hold: Hold): string {
  return hold.kind === "main" ? payerMemberId : `${payerMemberId}:cover:${hold.shareMemberId}`;
}

/** A PostgREST filter, for `.filter(...)`, that keeps only this hold's `payment_holds` rows. */
export function holdFilter(mandateId: string, hold: Hold): [column: string, operator: string, value: string] {
  return hold.kind === "main"
    ? ["idempotency_key", "not.like", `${COVER_PREFIX}%`]
    : ["idempotency_key", "eq", coverRowKey(mandateId, hold.shareMemberId)];
}

interface KeyedRow {
  payer_member_id: string | null;
  share_member_id: string;
  idempotency_key: string;
  stripe_payment_intent_id: string | null;
}

/** The payer and hold behind a PaymentIntent: a cover hold only when every row on it is a cover row. */
export function holdOfIntent(rows: KeyedRow[], intentId: string): { payer: string; hold: Hold } {
  const onIntent = rows.filter((r) => r.stripe_payment_intent_id === intentId && r.payer_member_id);
  const first = onIntent[0];
  if (!first) throw new Error(`no share row is on PaymentIntent ${intentId}`);
  const cover = onIntent.every((r) => r.idempotency_key.startsWith(COVER_PREFIX));
  return { payer: first.payer_member_id!, hold: cover ? { kind: "cover", shareMemberId: first.share_member_id } : { kind: "main" } };
}

/** The hold a provider event is about. A cover hold's PaymentIntent carries `cover_share_member_id`. */
export function holdForMetadata(metadata: Record<string, string | undefined>): Hold {
  const share = metadata.cover_share_member_id;
  return share ? { kind: "cover", shareMemberId: share } : { kind: "main" };
}
