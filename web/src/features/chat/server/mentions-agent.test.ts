import { describe, expect, it } from "vitest";
import { mentionsAgent } from "./send-message";

describe("mentionsAgent", () => {
  it("matches @agent as a whole word in any case", () => {
    for (const body of ["@agent plan Saturday", "hey @Agent, book it", "(@AGENT)", "ok\n@agent"]) expect(mentionsAgent(body), body).toBe(true);
  });

  it("ignores emails, longer names, and the bare word", () => {
    for (const body of ["mail me@agent.test", "@agents assemble", "@agent-smith", "the agent says hi", "x.@agent"]) {
      expect(mentionsAgent(body), body).toBe(false);
    }
  });
});
