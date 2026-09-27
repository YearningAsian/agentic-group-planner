import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pairsAgentWithPaid } from "@agp/shared";
import { describe, expect, it } from "vitest";

const web = path.resolve(__dirname, "../../..");
const roots = [path.join(web, "src"), path.join(web, "scripts/demo/fixtures"), path.resolve(web, "../packages/shared/src")];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Tests hold counterexamples on purpose; everything else is copy a person could read.
const copyFiles = () =>
  roots.flatMap(walk).filter((f) => /\.(tsx?|json|md)$/.test(f) && !/\.test\.tsx?$/.test(f));

describe("human-in-the-loop copy", () => {
  it("no copy, prompt, or fixture makes the agent the one who paid", () => {
    const offenders = copyFiles().flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ file: path.relative(web, file), line: i + 1, text: line.trim() }))
        .filter(({ text }) => pairsAgentWithPaid(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("no copy, prompt, or fixture asks members to vote", () => {
    // Nothing is votable since the journey pivot (design §11.6): the group comments, and the organizer
    // locks. The `voting` item status stays, so this matches the request, not the word.
    const offenders = copyFiles().flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ file: path.relative(web, file), line: i + 1, text: line.trim() }))
        .filter(({ text }) => /\bvote (on|for)\b|\bto vote\b/i.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("the scan reads the directories it claims to", () => {
    expect(copyFiles().some((f) => f.endsWith(path.join("lib", "tools", "cards.tsx")))).toBe(true);
    expect(copyFiles().some((f) => f.endsWith(path.join("cards", "approval.ts")))).toBe(true);
  });
});
