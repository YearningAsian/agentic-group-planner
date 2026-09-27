/** Display name for the Supabase session email. Seeded people keep the Person N label. */

export function sessionLabel(email: string | null): string | null {
  if (!email) return null;
  const match = /^person([123])@/i.exec(email);
  if (match?.[1]) return `Person ${match[1]}`;
  return email;
}
