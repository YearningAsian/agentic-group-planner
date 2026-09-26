import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const web = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: web });

/** The boundary rules a file breaks, by rule ID. Only design §1's import rules count here. */
async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(web, file) });
  return result!.messages
    .filter((m) => m.severity === 2 && (m.ruleId === "no-restricted-imports" || m.ruleId?.startsWith("boundaries/")))
    .map((m) => m.ruleId!);
}

describe("import boundaries (design §1)", () => {
  it("app/ deep-importing features/payments/server/approve-hold is an error", async () => {
    const code = 'import { approveHold } from "@/features/payments/server/approve-hold";\nexport const x = approveHold;\n';
    expect(await boundaryErrors("src/app/api/mandates/[id]/approve/route.ts", code)).toContain("no-restricted-imports");
  });

  it("app/ importing features/payments/server is allowed", async () => {
    const code = 'import { approveHold } from "@/features/payments/server";\nexport const x = approveHold;\n';
    expect(await boundaryErrors("src/app/api/mandates/[id]/approve/route.ts", code)).toEqual([]);
  });

  it("lib/optimizer importing any feature is an error", async () => {
    for (const source of ["@/features/itinerary/server", "@/features/chat"]) {
      const code = `import * as feature from "${source}";\nexport const x = feature;\n`;
      expect(await boundaryErrors("src/lib/optimizer/build-plan-request.ts", code), source).toContain("no-restricted-imports");
    }
  });

  it("lib/agent and lib/tools may import a feature's server entry point", async () => {
    const code = 'import { applyPlan } from "@/features/itinerary/server";\nexport const x = applyPlan;\n';
    expect(await boundaryErrors("src/lib/tools/plan-day/tool.ts", code)).toEqual([]);
    expect(await boundaryErrors("src/lib/agent/runner.ts", code)).toEqual([]);
  });

  it("a client component importing lib/providers is an error", async () => {
    const code = '"use client";\nimport { getLlmProvider } from "@/lib/providers/llm";\nexport const x = getLlmProvider;\n';
    expect(await boundaryErrors("src/features/chat/components/composer.tsx", code)).toContain("boundaries/no-server-imports-in-client");
    const server = '"use client";\nimport { sendMessage } from "@/features/chat/server";\nexport const x = sendMessage;\n';
    expect(await boundaryErrors("src/features/chat/components/composer.tsx", server)).toContain("boundaries/no-server-imports-in-client");
    // The same import in server code is fine.
    const serverCode = 'import { getLlmProvider } from "@/lib/providers/llm";\nexport const x = getLlmProvider;\n';
    expect(await boundaryErrors("src/lib/agent/runner.ts", serverCode)).toEqual([]);
  });

  it("only a provider's index is importable from outside it", async () => {
    const code = 'import { createMockLlmProvider } from "@/lib/providers/llm/mock";\nexport const x = createMockLlmProvider;\n';
    expect(await boundaryErrors("src/lib/agent/runner.ts", code)).toContain("no-restricted-imports");
  });
});
