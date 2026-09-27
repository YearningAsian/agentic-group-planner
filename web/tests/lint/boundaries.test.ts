import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

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
  // The first lint builds the typed program, which can outlast the default 5 s test timeout.
  beforeAll(() => boundaryErrors("src/lib/money/format.ts", "export const x = 1;\n"), 60_000);

  it("app/ deep-importing features/payments/server/approve-hold is an error", async () => {
    const code = 'import { approveHold } from "@/features/payments/server/approve-hold";\nexport const x = approveHold;\n';
    expect(await boundaryErrors("src/app/api/mandates/[id]/approve/route.ts", code)).toContain("boundaries/entry-points");
  });

  it("app/ importing features/payments/server is allowed", async () => {
    const code = 'import { approveHold } from "@/features/payments/server";\nexport const x = approveHold;\n';
    expect(await boundaryErrors("src/app/api/mandates/[id]/approve/route.ts", code)).toEqual([]);
  });

  it("lib/optimizer importing any feature is an error", async () => {
    for (const source of ["@/features/itinerary/server", "@/features/chat"]) {
      const code = `import * as feature from "${source}";\nexport const x = feature;\n`;
      expect(await boundaryErrors("src/lib/optimizer/build-plan-request.ts", code), source).toContain("boundaries/entry-points");
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
    expect(await boundaryErrors("src/lib/agent/runner.ts", code)).toContain("boundaries/entry-points");
  });

  it("relative imports are held to the same rules as @/ imports", async () => {
    const deep = 'import { approveHold } from "../../../../../features/payments/server/approve-hold";\nexport const x = approveHold;\n';
    expect(await boundaryErrors("src/app/api/mandates/[id]/approve/route.ts", deep)).toContain("boundaries/entry-points");
    const fromLib = 'import * as chat from "../../features/chat";\nexport const x = chat;\n';
    expect(await boundaryErrors("src/lib/money/format.ts", fromLib)).toContain("boundaries/entry-points");
    const client = '"use client";\nimport { sendMessage } from "../server";\nexport const x = sendMessage;\n';
    expect(await boundaryErrors("src/features/chat/components/composer.tsx", client)).toContain("boundaries/no-server-imports-in-client");
  });

  it("a client component can't dynamically import server code or a tool's handler", async () => {
    const dynamic = '"use client";\nexport const load = () => import("@/lib/providers/llm");\n';
    expect(await boundaryErrors("src/features/chat/components/composer.tsx", dynamic)).toContain("boundaries/no-server-imports-in-client");
    const tool = '"use client";\nimport { planDayTool } from "@/lib/tools/plan-day/tool";\nexport const x = planDayTool;\n';
    expect(await boundaryErrors("src/lib/tools/plan-day/card.tsx", tool)).toContain("boundaries/no-server-imports-in-client");
  });

  it("type-only imports and a feature's own deep imports are allowed", async () => {
    const types = '"use client";\nimport type { AppError } from "@/lib/reliability";\nexport type X = AppError;\n';
    expect(await boundaryErrors("src/features/chat/components/composer.tsx", types)).toEqual([]);
    const own = 'import { useMessages } from "@/features/chat/hooks/use-messages";\nexport const x = useMessages;\n';
    expect(await boundaryErrors("src/features/chat/components/message-list.tsx", own)).toEqual([]);
  });

  it('a client component may import a "use server" action module', async () => {
    const action = '"use client";\nimport { demoSignInSeeded } from "../server/demo-sign-in";\nexport const x = demoSignInSeeded;\n';
    expect(await boundaryErrors("src/features/demo/components/demo-login-picker.tsx", action)).toEqual([]);
  });
});
