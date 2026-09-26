import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let person1: TestUser;
let person2: TestUser;
let tripId: string;
let memberIds: string[];

beforeAll(async () => {
  person1 = await createUser({ batch, displayName: "Person 1" });
  person2 = await createUser({ batch, displayName: "Person 2" });
  ({ tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
    ],
  }));
});

afterAll(() => cleanup(batch));

function run(status: string) {
  return { trip_id: tripId, trigger: "mention", status, provider: "mock", model: "muse-spark-1.3", seed_batch: batch };
}

describe("agent and chat migration", () => {
  it("a user inserts only a text message as their own member", async () => {
    const own = { trip_id: tripId, sender_type: "member", sender_member_id: memberIds[0], kind: "text", body: "hi" };
    const ok = await person1.client.from("messages").insert({ ...own, client_id: randomUUID(), seed_batch: batch });
    expect(ok.error).toBeNull();

    const asSomeoneElse = await person1.client
      .from("messages")
      .insert({ ...own, sender_member_id: memberIds[1], client_id: randomUUID() });
    expect(asSomeoneElse.error?.code).toBe("42501");

    const card = await person1.client
      .from("messages")
      .insert({ ...own, kind: "card", card_type: "error", card_payload: {}, client_id: randomUUID() });
    expect(card.error?.code).toBe("42501");

    const asAgent = await person1.client
      .from("messages")
      .insert({ trip_id: tripId, sender_type: "agent", kind: "text", body: "I'm the agent", client_id: randomUUID() });
    expect(asAgent.error?.code).toBe("42501");

    // Person 2 reads Person 1's message; the policy is membership, not authorship.
    const seen = await person2.client.from("messages").select("body").eq("trip_id", tripId);
    expect(seen.data?.map((m) => m.body)).toContain("hi");
  });

  it("a second running run for the same trip violates the unique index", async () => {
    const first = await admin.from("agent_runs").insert(run("running"));
    expect(first.error).toBeNull();
    const second = await admin.from("agent_runs").insert(run("running"));
    expect(second.error?.code).toBe("23505");
    const queued = await admin.from("agent_runs").insert(run("queued"));
    expect(queued.error).toBeNull();
  });

  it("messages.client_id is unique", async () => {
    const clientId = randomUUID();
    const row = { trip_id: tripId, sender_type: "system", kind: "text", body: "x", client_id: clientId, seed_batch: batch };
    expect((await admin.from("messages").insert(row)).error).toBeNull();
    expect((await admin.from("messages").insert(row)).error?.code).toBe("23505");
  });

  it("card_type is required exactly when kind = card", async () => {
    const base = { trip_id: tripId, sender_type: "agent", seed_batch: batch };
    const cardWithoutType = await admin.from("messages").insert({ ...base, kind: "card", card_payload: {} });
    expect(cardWithoutType.error?.code).toBe("23514");
    const textWithType = await admin.from("messages").insert({ ...base, kind: "text", body: "x", card_type: "plan" });
    expect(textWithType.error?.code).toBe("23514");
    const card = await admin.from("messages").insert({ ...base, kind: "card", card_type: "plan", card_payload: {} });
    expect(card.error).toBeNull();
  });

  it("a run's status only moves forward", async () => {
    const { data } = await admin.from("agent_runs").insert(run("queued")).select("id").single();
    const skip = await admin.from("agent_runs").update({ status: "succeeded" }).eq("id", data!.id);
    expect(skip.error?.message).toContain("invalid_transition");
  });
});
