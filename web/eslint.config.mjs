import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const srcDir = path.join(import.meta.dirname, "src");

/**
 * An import's target as an `@/` path, whether it was written `@/…` or relative, so the rules below
 * see both. Null for packages and for anything outside src/.
 */
function aliasOf(source, filename) {
  if (source.startsWith("@/")) return source;
  if (!source.startsWith(".")) return null;
  const rel = path.relative(srcDir, path.resolve(path.dirname(filename), source));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `@/${rel.split(path.sep).join("/").replace(/\.(tsx?|mjs|js)$/, "")}`;
}

/** The feature or provider a file belongs to, so its own deep imports stay allowed. */
function ownerOf(filename) {
  const rel = path.relative(srcDir, filename).split(path.sep).join("/");
  return {
    feature: /^features\/([^/]+)\//.exec(rel)?.[1],
    provider: /^lib\/providers\/([^/]+)\//.exec(rel)?.[1],
  };
}

/**
 * Whether an `@/` target is a server action module: its file opens with "use server". Next.js turns
 * a client's import of one into references, so the client may import it (design §1, `demoSignIn`).
 */
function isServerActionModule(target) {
  const base = path.join(srcDir, target.slice(2));
  for (const file of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const body = code.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
    return /^(["'])use server\1/.test(body);
  }
  return false;
}

/** Server-only code a "use client" module must never import (design §1). */
const SERVER_ONLY = [
  /^server-only$/,
  /^@\/lib\/providers(\/|$)/,
  /^@\/features\/[^/]+\/server(\/|$)/,
  /^@\/lib\/supabase\/(admin|server)$/,
  /^@\/lib\/(agent|tools\/registry|optimizer|reliability|env\/server)(\/|$)/,
  /^@\/lib\/tools\/[^/]+\/tool$/,
];

/** Import declarations, re-exports, and dynamic imports, skipping type-only ones (they're erased). */
function onImports(check) {
  const typeOnly = (node) =>
    node.importKind === "type" ||
    node.exportKind === "type" ||
    (node.specifiers?.length > 0 && node.specifiers.every((s) => s.importKind === "type" || s.exportKind === "type"));
  const visit = (node) => {
    const source = node.source?.value;
    if (typeof source === "string" && !typeOnly(node)) check(node, source);
  };
  return { ImportDeclaration: visit, ExportNamedDeclaration: visit, ExportAllDeclaration: visit, ImportExpression: visit };
}

const boundaries = {
  rules: {
    // Design §1: other code reaches a feature only through its index.ts (client-safe) or server.ts,
    // and a provider only through its index.ts. lib/* modules other than lib/agent and lib/tools
    // don't import features at all (`noFeatures`).
    "entry-points": {
      meta: {
        type: "problem",
        docs: { description: "Features and providers are imported through their entry points." },
        messages: {
          feature: "Import a feature through its index.ts or server.ts entry point, not '{{source}}' (design §1).",
          provider: "Import a provider through its index.ts, not '{{source}}' (design §1).",
          noFeatures: "Only lib/agent and lib/tools may import features; other lib/* modules import lib/* and @agp/shared (design §1).",
        },
        schema: [{ type: "object", properties: { noFeatures: { type: "boolean" } }, additionalProperties: false }],
      },
      create(context) {
        const { noFeatures = false } = context.options[0] ?? {};
        const owner = ownerOf(context.filename);
        return onImports((node, source) => {
          const target = aliasOf(source, context.filename);
          if (!target) return;
          const feature = /^@\/features\/([^/]+)(?:\/(.+))?$/.exec(target);
          if (feature) {
            if (noFeatures) context.report({ node: node.source, messageId: "noFeatures" });
            else if (feature[2] && !["server", "index"].includes(feature[2]) && owner.feature !== feature[1]) {
              context.report({ node: node.source, messageId: "feature", data: { source } });
            }
            return;
          }
          const provider = /^@\/lib\/providers\/([^/]+)\/(.+)$/.exec(target);
          if (provider && provider[2] !== "index" && owner.provider !== provider[1]) {
            context.report({ node: node.source, messageId: "provider", data: { source } });
          }
        });
      },
    },
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
        return onImports((node, source) => {
          const target = aliasOf(source, context.filename) ?? source;
          if (SERVER_ONLY.some((pattern) => pattern.test(target)) && !(target.startsWith("@/") && isServerActionModule(target))) {
            context.report({ node: node.source, messageId: "serverImport", data: { source } });
          }
        });
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
      "boundaries/entry-points": "error",
      "boundaries/no-server-imports-in-client": "error",
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    ignores: ["src/lib/agent/**", "src/lib/tools/**", "**/*.test.{ts,tsx}"],
    plugins: { boundaries },
    rules: { "boundaries/entry-points": ["error", { noFeatures: true }] },
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
