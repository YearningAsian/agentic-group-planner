import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
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
  if (profile.stripe_customer_id && profile.default_payment_method_id) {
    return { customerId: profile.stripe_customer_id, paymentMethodId: profile.default_payment_method_id };
  }
  if (!(deps.demoMode ?? getServerEnv().NEXT_PUBLIC_DEMO_MODE)) {
    throw new AppError("not_permitted", "Add a payment method before approving this purchase.");
  }

  const payments = deps.payments ?? getPaymentsProvider();
  const customerId = profile.stripe_customer_id ??
    (await payments.ensureCustomer({ profileId: member.profile_id, name: member.display_name })).customerId;
  if (!profile.stripe_customer_id) {
    const saved = await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", member.profile_id);
    if (saved.error) throw readError(saved.error, "your profile");
  }
  const paymentMethodId = profile.default_payment_method_id ??
    (await payments.attachTestCard({ customerId, card: "visa" })).paymentMethodId;
  if (!profile.default_payment_method_id) {
    const saved = await admin.from("profiles").update({ default_payment_method_id: paymentMethodId }).eq("id", member.profile_id);
    if (saved.error) throw readError(saved.error, "your profile");
  }
  return { customerId, paymentMethodId };
}
