import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Design §1: other code reaches a feature only through its index.ts (client-safe) or server.ts, and
// a provider only through its index.ts.
const entryPointsOnly = [
  {
    group: ["@/features/*/**", "!@/features/*/server", "!@/features/*/index"],
    message: "Import a feature through its index.ts or server.ts entry point (design §1).",
  },
  {
    group: ["@/lib/providers/*/**", "!@/lib/providers/*/index"],
    message: "Import a provider through its index.ts (design §1).",
  },
];

// lib/agent and lib/tools orchestrate features; every other lib module stays below them.
const noFeatures = {
  group: ["@/features", "@/features/**"],
  message: "Only lib/agent and lib/tools may import features; other lib/* modules import lib/* and @agp/shared (design §1).",
};

/** Server-only code a "use client" module must never import (design §1). */
const SERVER_ONLY = [
  /^server-only$/,
  /^@\/lib\/providers(\/|$)/,
  /^@\/features\/[^/]+\/server(\/|$)/,
  /^@\/lib\/supabase\/(admin|server)$/,
  /^@\/lib\/(agent|tools\/registry|optimizer|reliability|env\/server)(\/|$)/,
];

const boundaries = {
  rules: {
    "no-server-imports-in-client": {
      meta: {
        type: "problem",
        docs: { description: "A client component never imports server-only code." },
        messages: { serverImport: "'{{source}}' is server-only; a \"use client\" module can't import it (design §1)." },
        schema: [],
      },
      create(context) {
        const isClient = context.sourceCode.ast.body.some(
          (node) => node.type === "ExpressionStatement" && node.directive === "use client",
        );
        if (!isClient) return {};
        const check = (node) => {
          const source = node.source?.value;
          if (typeof source === "string" && SERVER_ONLY.some((pattern) => pattern.test(source))) {
            context.report({ node: node.source, messageId: "serverImport", data: { source } });
          }
        };
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
      },
    },
  },
};

const appCode = { files: ["src/**/*.{ts,tsx}"], ignores: ["**/*.test.{ts,tsx}"] };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ...appCode,
    plugins: { boundaries },
    rules: {
      "no-restricted-imports": ["error", { patterns: entryPointsOnly }],
      "boundaries/no-server-imports-in-client": "error",
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    ignores: ["src/lib/agent/**", "src/lib/tools/**", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [...entryPointsOnly, noFeatures] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's prebuilt worker bundle, copied from node_modules (not our source).
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;
