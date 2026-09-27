"use client";

import Link from "next/link";

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-line" />
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

export function AuthSwitchLink({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <p className="text-center text-sm text-muted">
      {prompt}{" "}
      <Link href={href} className="font-semibold text-lagoon-ink underline-offset-2 hover:underline">
        {label}
      </Link>
    </p>
  );
}
