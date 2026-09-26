export interface LeadGuest {
  givenName: string;
  familyName: string;
  email: string;
  phoneNumber: string;
}

/** The hotel's lead guest from an account, or null when it lacks an email or a phone number. */
export function leadGuestFrom(account: { displayName: string; email: string | null; phone: string | null }): LeadGuest | null {
  const email = account.email?.trim();
  const phoneNumber = account.phone?.trim();
  if (!email || !phoneNumber) return null;
  const name = account.displayName.trim();
  const space = name.indexOf(" ");
  const givenName = space === -1 ? name : name.slice(0, space);
  const familyName = space === -1 ? name : name.slice(space + 1).trim();
  return { givenName, familyName, email, phoneNumber };
}
