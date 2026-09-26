import "server-only";
import type { HoldStatus } from "@agp/shared";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { type FinalizeDeps, finalizeMandate } from "./finalize-mandate";
import { readError } from "./rpc-error";
import { settleFrontedShare } from "./settle-fronted-share";

/** Long enough for an authorization with its retries; short enough that a crash only delays a retry. */
const PROVIDER_LEASE_MS = 60_000;

export interface PaymentsDeps extends FinalizeDeps {
  /** The payments provider; tests pass a wrapped one to count or reorder calls. */
  payments?: PaymentsProvider;
  /** Runs once the approval that satisfies the last share wins open → authorized; defaults to finalizeMandate. */
  finalize?: (mandateId: string) => Promise<unknown>;
  /** Runs when a placeholder's hold is authorized after the capture; defaults to settleFrontedShare. */
  settle?: (input: { mandateId: string; memberId: string }) => Promise<unknown>;
}

export interface ApproveHoldResult {
  /** The approving member's share rows (their hold), after the approval. */
  holds: { hold_id: string; status: HoldStatus }[];
  /** Whether every share of the mandate now has a row that may pay it authorized. */
  satisfied: boolean;
}

interface Member {
  id: string;
  profile_id: string | null;
  display_name: string;
}

async function payerRows(admin: AdminClient, mandateId: string, memberId: string) {
  const { data, error } = await admin
    .from("payment_holds")
    .select("id, status, cap_cents, kind, pays_share")
    .eq("mandate_id", mandateId)
    .eq("payer_member_id", memberId)
    .order("kind", { ascending: false });
  if (error) throw readError(error, "the holds");
  return data;
}

/**
 * The member a signed-in profile approves as: a joined member of the mandate's trip. Anyone else
 * gets `not_permitted` (403).
 */
export async function approverFor(input: { mandateId: string; profileId: string }): Promise<string> {
  const admin = getAdminClient();
  const { data: mandate, error } = await admin.from("mandates").select("trip_id").eq("id", input.mandateId).maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (!mandate) throw new AppError("not_found", "That purchase doesn't exist.");
  const { data: member, error: memberError } = await admin
    .from("trip_members")
    .select("id")
    .eq("trip_id", mandate.trip_id)
    .eq("profile_id", input.profileId)
    .eq("status", "joined")
    .maybeSingle();
  if (memberError) throw readError(memberError, "the trip's members");
  if (!member) throw new AppError("not_permitted", "Only members of this trip can approve its purchases.");
  return member.id;
}

/**
 * The payer's saved customer and card. Until members can add their own card, a payer without one
 * gets the provider's test visa (the app runs on Stripe test mode only), saved on their profile.
 */
async function paymentMethodFor(admin: AdminClient, payments: PaymentsProvider, member: Member) {
  if (!member.profile_id) throw new AppError("not_permitted", "Join the trip before approving.");
  const { data: profile, error } = await admin
    .from("profiles")
    .select("stripe_customer_id, default_payment_method_id")
    .eq("id", member.profile_id)
    .single();
  if (error) throw readError(error, "your profile");
  const customerId =
    profile.stripe_customer_id ??
    (await payments.ensureCustomer({ profileId: member.profile_id, name: member.display_name })).customerId;
  const paymentMethodId =
    profile.default_payment_method_id ?? (await payments.attachTestCard({ customerId, card: "visa" })).paymentMethodId;
  if (customerId !== profile.stripe_customer_id || paymentMethodId !== profile.default_payment_method_id) {
    const saved = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId, default_payment_method_id: paymentMethodId })
      .eq("id", member.profile_id);
    if (saved.error) throw readError(saved.error, "your profile");
  }
  return { customerId, paymentMethodId };
}

/**
 * Authorizes the payer's one hold for every row they may pay, if this call wins the claim on
 * their pending rows. A concurrent approval by the same payer finds nothing to claim and returns,
 * so the provider is called once; its idempotency key covers a retry after a crash.
 */
async function authorizeHold(
  admin: AdminClient,
  payments: PaymentsProvider,
  mandate: { id: string; trip_id: string; currency: string },
  member: Member,
  phase: "approving" | "settling",
): Promise<void> {
  const now = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("payment_holds")
    .update({ lease_expires_at: new Date(now.getTime() + PROVIDER_LEASE_MS).toISOString() })
    .eq("mandate_id", mandate.id)
    .eq("payer_member_id", member.id)
    .eq("status", "pending")
    .or(`lease_expires_at.is.null,lease_expires_at.lt."${now.toISOString()}"`)
    .select("id");
  if (claimError) throw readError(claimError, "the holds");
  if (claimed.length === 0) return;

  const release = () =>
    admin.from("payment_holds").update({ lease_expires_at: null }).in("id", claimed.map((r) => r.id)).eq("status", "pending");
  try {
    if (phase === "approving") {
      // The finalizer plans from rows it reads after winning open → authorized. Past that point
      // this claim might be missed, so stop before calling the provider. Before it, the finalizer
      // sees this claim and marks the row, and the update below learns it lost (design §4.2).
      const { data: current, error } = await admin.from("mandates").select("status").eq("id", mandate.id).single();
      if (error) throw readError(error, "the purchase");
      if (current.status !== "open" && current.status !== "partially_declined") throw finalizing();
    }

    // The hold covers every row this member may pay (the organizer's includes fronted shares),
    // so the amount is the same on every attempt with this idempotency key.
    const rows = await payerRows(admin, mandate.id, member.id);
    const amountCents = rows.reduce((sum, r) => sum + r.cap_cents, 0);
    const { customerId, paymentMethodId } = await paymentMethodFor(admin, payments, member);
    const result = await payments.authorize({
      customerId,
      paymentMethodId,
      amountCents,
      currency: mandate.currency,
      metadata: { mandate_id: mandate.id, payer_member_id: member.id, trip_id: mandate.trip_id },
      idempotencyKey: `pi-auth:${mandate.id}:${member.id}`,
    });

    if (result.status !== "authorized") {
      const { error } = await admin
        .from("payment_holds")
        .update({
          status: result.status === "declined" ? "declined" : "failed",
          stripe_payment_intent_id: result.paymentIntentId,
          decline_code: result.declineCode ?? null,
          lease_expires_at: null,
        })
        .eq("mandate_id", mandate.id)
        .eq("payer_member_id", member.id)
        .eq("status", "pending");
      if (error) throw readError(error, "the holds");
      if (phase === "approving") {
        const declined = await admin.from("mandates").update({ status: "partially_declined" }).eq("id", mandate.id).eq("status", "open");
        if (declined.error) throw readError(declined.error, "the purchase");
      }
      return;
    }

    // Conditional: the webhook may already have authorized these rows, and a finalizer that saw
    // this approval in flight marks them pays_share = false, which this update must not undo. A
    // finalizer that re-plans clears its marks again, so look once more before giving up.
    let excluded: Awaited<ReturnType<typeof payerRows>> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await admin
        .from("payment_holds")
        .update({ status: "authorized", stripe_payment_intent_id: result.paymentIntentId, lease_expires_at: null, authorized_at: new Date().toISOString() })
        .eq("mandate_id", mandate.id)
        .eq("payer_member_id", member.id)
        .eq("status", "pending")
        .is("pays_share", null);
      if (error) throw readError(error, "the holds");
      const pending = (await payerRows(admin, mandate.id, member.id)).filter((r) => r.status === "pending");
      excluded = pending.filter((r) => r.pays_share === false);
      if (pending.length === excluded.length) break;
    }
    if (excluded.length > 0) {
      // The finalizer planned without this hold: another row already pays these shares.
      await payments.release({ paymentIntentId: result.paymentIntentId, idempotencyKey: `pi-release:${mandate.id}:${member.id}` });
      const released = await admin
        .from("payment_holds")
        .update({ status: "released", stripe_payment_intent_id: result.paymentIntentId, lease_expires_at: null })
        .in("id", excluded.map((r) => r.id))
        .eq("status", "pending");
      if (released.error) throw readError(released.error, "the holds");
    }
  } catch (error) {
    await release();
    throw error;
  }
}

function finalizing(): AppError {
  return new AppError("conflict", "This purchase is being finalized. Try again in a moment.", { retryable: true });
}

/** A share is satisfied when a row that may pay it is authorized (design §4.2). */
export async function isSatisfied(admin: AdminClient, mandateId: string): Promise<boolean> {
  const { data, error } = await admin.from("payment_holds").select("share_member_id, status").eq("mandate_id", mandateId);
  if (error) throw readError(error, "the holds");
  const satisfied = new Map<string, boolean>();
  for (const row of data) {
    const paid = row.status === "authorized" || row.status === "captured";
    satisfied.set(row.share_member_id, (satisfied.get(row.share_member_id) ?? false) || paid);
  }
  return satisfied.size > 0 && [...satisfied.values()].every(Boolean);
}

/**
 * A member approves their hold on a mandate (design §4.2, §5.4). One PaymentIntent is authorized
 * per payer, for the sum of the caps of the rows they may pay: the organizer's covers their own
 * share and every share they front. A declined card moves the payer's rows to `declined` and the
 * mandate to `partially_declined`. Once every share is satisfied, exactly one caller wins the
 * conditional update open → authorized and finalizes the mandate. Approving again, or
 * concurrently, changes nothing.
 */
export async function approveHold(input: { mandateId: string; memberId: string }, deps: PaymentsDeps = {}): Promise<ApproveHoldResult> {
  const admin = getAdminClient();
  const payments = deps.payments ?? getPaymentsProvider();

  const { data: mandate, error } = await admin
    .from("mandates")
    .select("id, trip_id, status, currency, expires_at")
    .eq("id", input.mandateId)
    .maybeSingle();
  if (error) throw readError(error, "the purchase");
  if (!mandate) throw new AppError("not_found", "That purchase doesn't exist.");
  const { data: member, error: memberError } = await admin
    .from("trip_members")
    .select("id, profile_id, display_name, status")
    .eq("id", input.memberId)
    .eq("trip_id", mandate.trip_id)
    .maybeSingle();
  if (memberError) throw readError(memberError, "the trip's members");
  if (!member || member.status !== "joined") throw new AppError("not_permitted", "Only members of this trip can approve its purchases.");

  const rows = await payerRows(admin, mandate.id, member.id);
  if (rows.length === 0) throw new AppError("not_permitted", "You don't have a share of this purchase to approve.");
  const open = mandate.status === "open" || mandate.status === "partially_declined";
  if (rows.some((r) => r.status === "pending")) {
    if (open) {
      if (Date.parse(mandate.expires_at) < Date.now()) throw new AppError("conflict", "The time to approve this purchase has run out.");
      await authorizeHold(admin, payments, mandate, member, "approving");
    } else if (mandate.status === "captured") {
      // A placeholder who joined after the booking pays their share now (design §4.2).
      await authorizeHold(admin, payments, mandate, member, "settling");
    } else if (mandate.status === "authorized") {
      throw finalizing();
    } else {
      throw new AppError("conflict", "This purchase isn't waiting for approvals any more.");
    }
  }

  if (mandate.status === "captured") {
    const own = (await payerRows(admin, mandate.id, member.id)).find((r) => r.kind === "own" && r.status === "authorized");
    if (own) await (deps.settle ?? ((i) => settleFrontedShare(i, deps)))({ mandateId: mandate.id, memberId: member.id });
  }

  const satisfied = await isSatisfied(admin, mandate.id);
  if (satisfied && open) {
    const { data: won, error: winError } = await admin
      .from("mandates")
      .update({ status: "authorized" })
      .eq("id", mandate.id)
      .eq("status", "open")
      .select("id");
    if (winError) throw readError(winError, "the purchase");
    if (won.length > 0) await (deps.finalize ?? ((id: string) => finalizeMandate(id, deps)))(mandate.id);
  }

  const after = await payerRows(admin, mandate.id, member.id);
  return { holds: after.map((r) => ({ hold_id: r.id, status: r.status as HoldStatus })), satisfied };
}
