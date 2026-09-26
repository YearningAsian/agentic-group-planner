import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSupabase } from "@/lib/supabase";
import { makeQueryClient, Providers } from "./providers";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
});
afterEach(() => vi.unstubAllEnvs());

function Probe() {
  const queries = useQueryClient().getDefaultOptions().queries;
  const supabase = useSupabase();
  return (
    <p>
      {String(queries?.staleTime)} {String(queries?.retry)} {String(queries?.refetchOnWindowFocus)}{" "}
      {typeof supabase.from}
    </p>
  );
}

describe("Providers", () => {
  it("query defaults are staleTime 30 s, retry 2, and refetchOnWindowFocus true", () => {
    const queries = makeQueryClient().getDefaultOptions().queries;
    expect(queries).toMatchObject({ staleTime: 30_000, retry: 2, refetchOnWindowFocus: true });

    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(screen.getByText("30000 2 true function")).toBeInTheDocument();
  });
});
