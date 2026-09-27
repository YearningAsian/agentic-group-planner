import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";
import { CHAT_UNAVAILABLE } from "@/lib/planner-chat/types";

const runPlannerChat = vi.fn();
let env: {
  META_MODEL_API_KEY?: string;
  META_MODEL_API_BASE_URL: string;
  PLANNER_CHAT_MODEL: string;
  DUFFEL_ACCESS_TOKEN?: string;
  NEXT_PUBLIC_APP_URL: string;
};

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => env,
}));

vi.mock("@/lib/planner-chat/run", () => ({
  runPlannerChat: (...args: unknown[]) => runPlannerChat(...args),
}));

describe("POST /api/planner/chat", () => {
  beforeEach(() => {
    runPlannerChat.mockReset();
    env = {
      META_MODEL_API_KEY: "meta-test",
      META_MODEL_API_BASE_URL: "https://api.meta.ai/v1",
      PLANNER_CHAT_MODEL: "muse-spark-1.3",
      DUFFEL_ACCESS_TOKEN: "duffel_test_abc",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    };
  });

  it("says chat is unavailable when the Meta key is missing", async () => {
    env = { ...env, META_MODEL_API_KEY: undefined };
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "Miami in October" }] }),
      }),
    );
    expect(response.status).toBe(502);
    expect(runPlannerChat).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CHAT_UNAVAILABLE);
    expect(JSON.stringify(body)).not.toMatch(/META_MODEL|duffel_test|meta-test/);
  });

  it("sends the trip chat to Muse with the Meta key", async () => {
    runPlannerChat.mockReturnValue(new Response("ok"));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "Miami in October" }] }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runPlannerChat).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: "user", text: "Miami in October" }] }),
      expect.objectContaining({
        apiKey: "meta-test",
        baseURL: "https://api.meta.ai/v1",
        model: "muse-spark-1.3",
      }),
    );
    expect(runPlannerChat.mock.calls[0]?.[1]).not.toHaveProperty("duffelToken");
  });

  it("hides a provider failure", async () => {
    runPlannerChat.mockRejectedValue(new AppError("provider_unavailable", CHAT_UNAVAILABLE, { retryable: true }));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "Miami in October" }] }),
      }),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { message: CHAT_UNAVAILABLE } });
  });

  it("rejects an empty body", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/planner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(runPlannerChat).not.toHaveBeenCalled();
  });
});
