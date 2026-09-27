import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(__dirname, "..");
const appDir = path.join(src, "app");
const publicDir = path.resolve(src, "..", "public");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** One regex per page or route handler under src/app, with dynamic segments as wildcards. */
function routePatterns(): RegExp[] {
  return walk(appDir)
    .filter((file) => /[\\/](page\.tsx|route\.ts)$/.test(file))
    .map((file) => {
      const segments = path
        .relative(appDir, path.dirname(file))
        .split(path.sep)
        .filter((s) => s && !/^\(.*\)$/.test(s)) // route groups don't appear in the URL
        .map((s) => (s.startsWith("[...") ? ".+" : s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return new RegExp(`^/${segments.join("/")}$`);
    });
}

/** Internal paths written as string literals in app code, with template expressions filled in. */
function internalPaths(): { file: string; target: string }[] {
  const files = walk(src).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}test${path.sep}`));
  return files.flatMap((file) => {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    return [...code.matchAll(/(["'`])(\/[a-z][^"'`\s]*)\1/g)].map((m) => ({
      file: path.relative(src, file),
      target: m[2].replace(/\$\{[^}]*\}/g, "x").split(/[?#]/)[0].replace(/\/$/, "") || "/",
    }));
  });
}

describe("internal links", () => {
  it("every internal path in app code resolves to a page, a route handler, or a public file", () => {
    const patterns = routePatterns();
    const isPublicFile = (target: string) => statSync(path.join(publicDir, target), { throwIfNoEntry: false }) !== undefined;
    const dead = internalPaths().filter(({ target }) => !isPublicFile(target) && !patterns.some((p) => p.test(target)));
    expect(dead).toEqual([]);
  });

  it("never places an internal trip UUID in a trip route or link", () => {
    const tripRouteWithId = walk(appDir).filter((file) => /[\\/]trips?[\\/]\[id\][\\/]/.test(file));
    expect(tripRouteWithId).toEqual([]);

    const tripIdLinks = walk(src)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /\/trips?\/\$\{(?:[^}]*\.)?(?:tripId|trip_id|id)\}/.test(readFileSync(file, "utf8")));
    expect(tripIdLinks).toEqual([]);
  });
});
