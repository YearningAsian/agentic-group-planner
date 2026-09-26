import { ToolName } from "@agp/shared";
import { describe, expect, it } from "vitest";
import { toolRegistry } from "./registry";

describe("tool registry", () => {
  it("registry lists exactly the 7 tool names from the tool_name enum", () => {
    expect(Object.keys(toolRegistry).sort()).toEqual([...ToolName.options].sort());
    for (const [name, tool] of Object.entries(toolRegistry)) {
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
