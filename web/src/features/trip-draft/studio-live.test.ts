import { describe, expect, it, vi } from "vitest";
import { bindStudioBoard } from "./studio-live";

describe("studio board doorbell", () => {
  it("refetches after a change and does not apply the event payload", async () => {
    const pull = vi.fn(async () => undefined);
    const onPulled = vi.fn();
    let handler: (() => void) | undefined;
    const stop = bindStudioBoard(
      (next) => {
        handler = next;
        return () => undefined;
      },
      pull,
      onPulled,
    );

    handler?.();
    await vi.waitFor(() => expect(onPulled).toHaveBeenCalledOnce());
    expect(pull).toHaveBeenCalledOnce();
    expect(pull.mock.invocationCallOrder[0]).toBeLessThan(onPulled.mock.invocationCallOrder[0]);
    stop();
  });
});
