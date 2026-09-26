import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
const startAgentRun = vi.fn();
const after = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/chat/server", () => ({ sendMessage }));
vi.mock("@/lib/agent", () => ({ startAgentRun }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after }));

const { POST, maxDuration } = await import("./route");

const valid = {
  client_id: "00000000-0000-4000-8000-000000000001",
  trip_id: "00000000-0000-4000-8000-000000000002",
  body: "@agent plan Saturday",
};

function post(body: unknown) {
  return POST(new Request("http://localhost/api/messages", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("POST /api/messages", () => {
  it("a body over 2000 characters returns 400 with { error: { code, message, retryable } }", async () => {
    const response = await post({ ...valid, body: "x".repeat(2001) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_input", message: expect.stringContaining("body"), retryable: false },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("malformed JSON and a missing client_id are 400s", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...valid, client_id: undefined })).status).toBe(400);
  });

  it("without a session it returns 401", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await post(valid);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });

  it("returns the ids and starts the run after the response", async () => {
    sendMessage.mockResolvedValue({ messageId: "m-1", agentRunId: "r-1" });

    const response = await post(valid);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message_id: "m-1", agent_run_id: "r-1" });
    expect(sendMessage).toHaveBeenCalledWith(expect.anything(), {
      tripId: valid.trip_id,
      clientId: valid.client_id,
      body: valid.body,
      itemId: undefined,
    });
    expect(startAgentRun).not.toHaveBeenCalled();
    await after.mock.calls[0]![0]();
    expect(startAgentRun).toHaveBeenCalledWith("r-1");
    expect(maxDuration).toBe(300);
  });

  it("a plain message starts no run", async () => {
    sendMessage.mockResolvedValue({ messageId: "m-2", agentRunId: null });
    const response = await post({ ...valid, body: "hello" });
    expect(await response.json()).toEqual({ message_id: "m-2", agent_run_id: null });
    expect(after).not.toHaveBeenCalled();
  });
});
