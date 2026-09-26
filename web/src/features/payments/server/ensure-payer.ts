import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { getPaymentsProvider, isMockPaymentId, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { readError } from "./rpc-error";

interface EnsurePayerDeps {
  admin?: AdminClient;
  payments?: PaymentsProvider;
  demoMode?: boolean;
}

/** Resolves a joined member's saved payer; only demo mode may attach a test card on demand. */
export async function ensurePayer(memberId: string, deps: EnsurePayerDeps = {}): Promise<{ customerId: string; paymentMethodId: string }> {
  const admin = deps.admin ?? getAdminClient();
  const { data: member, error: memberError } = await admin
    .from("trip_members")
    .select("profile_id, display_name, status")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw readError(memberError, "the trip's members");
  if (!member || member.status !== "joined" || !member.profile_id) {
    throw new AppError("not_permitted", "Join the trip before approving.");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("stripe_customer_id, default_payment_method_id")
    .eq("id", member.profile_id)
    .single();
  if (profileError) throw readError(profileError, "your profile");
  const payments = deps.payments ?? getPaymentsProvider();
  // On Stripe, IDs the mock provider left on this profile belong to no Stripe account.
  const usable = (id: string | null) => (id && !(payments.name === "real" && isMockPaymentId(id)) ? id : null);
  const storedCustomer = usable(profile.stripe_customer_id);
  // A card only belongs with the customer it was attached to, so a new customer never reuses one.
  const storedCard = storedCustomer ? usable(profile.default_payment_method_id) : null;
  if (storedCustomer && storedCard) return { customerId: storedCustomer, paymentMethodId: storedCard };
  if (!(deps.demoMode ?? getServerEnv().NEXT_PUBLIC_DEMO_MODE)) {
    throw new AppError("not_permitted", "Add a payment method before approving this purchase.");
  }

  const customerId = storedCustomer ??
    (await payments.ensureCustomer({ profileId: member.profile_id, name: member.display_name })).customerId;
  if (customerId !== profile.stripe_customer_id) {
    // Saved before the card is attached, so a failed attach never leads to a second customer; the
    // old card is cleared with it, since it can't be charged through the new customer.
    const saved = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId, default_payment_method_id: null })
      .eq("id", member.profile_id);
    if (saved.error) throw readError(saved.error, "your profile");
  }
  const paymentMethodId = storedCard ?? (await payments.attachTestCard({ customerId, card: "visa" })).paymentMethodId;
  if (paymentMethodId !== profile.default_payment_method_id || customerId !== profile.stripe_customer_id) {
    const saved = await admin.from("profiles").update({ default_payment_method_id: paymentMethodId }).eq("id", member.profile_id);
    if (saved.error) throw readError(saved.error, "your profile");
  }
  return { customerId, paymentMethodId };
}
