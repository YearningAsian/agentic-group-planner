"""Consistency checks for the planning docs.

Run from anywhere: `python planning/tools/check_plan.py`. Exits non-zero when any check fails.
Checks task IDs, dependency direction, tiers against the core flows, references from tracked
files to gitignored paths, personal names, real phone numbers, and leftover event logistics.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLANNING = ROOT / "planning"
PLAN = PLANNING / "plan.md"

TASK_HEADING = re.compile(r"^#### ((?:FE|AI|CO|VO)-(?:\d{3}|S\d{2})) · (.*) · (Must|Should)\s*$", re.M)
ANY_TASK_HEADING = re.compile(r"^#### (?:FE|AI|CO|VO)-", re.M)
REF = re.compile(r"((?:FE|AI|CO|VO)-(?:\d{3}|S\d{2}))(?:–(\d{3}))?")
PHONE = re.compile(r"\+1\d{10}")
PHONE_PLACEHOLDER = "+15555550100"
CAST_NAMES = re.compile(r"\b(Jordan|Ben|Cara|Ana)\b")
# Event logistics removed at the Phase 3 review. Case-sensitive where a lowercase form is legitimate
# (for example `pm_card_visa`, `metadata`).
LOGISTICS = [
    re.compile(p, flags)
    for p, flags in [
        (r"hackathon|HackGT|HexLabs|SpaceXAI|Sponsor Fair|sponsor", re.I),
        (r"\bjudg(e|es|ing)\b|\bExpo\b|rehears|hotspot|venue Wi-?Fi|demo video|backup video", re.I),
        # "Meta" left this list on 2026-09-25: Meta's Model API is now the model provider.
        (r"\b(Oracle|Visa)\b", 0),
        (r"\bhour 0\b|\bhours \d+[–-]\d+\b|\bh\d{1,2}\b", 0),
        (r"\bon stage\b|\bdemo (beat|path|script)\b", re.I),
    ]
]
# Lines that describe the removal itself are allowed to name what was removed.
LOGISTICS_ALLOWED = re.compile(r"no longer apply|are gone|restates its demo script|is now the core user flows|event sections")

# Task IDs retired at a review → where the work went. Mentioning one is allowed only on a line
# that also names its replacement, so old references can't linger unnoticed.
RETIRED = {
    "CO-206": "VO-213",
    "CO-211": "VO-214",
    "CO-S03": "CO-209",
}

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


def expand_refs(text: str) -> set[str]:
    refs: set[str] = set()
    for first, last in REF.findall(text):
        if last and not first.split("-")[1].startswith("S"):
            ws, n = first.split("-")
            refs.update(f"{ws}-{k:03d}" for k in range(int(n), int(last) + 1))
        else:
            refs.add(first)
    for ws, a, b in re.findall(r"((?:FE|AI|CO|VO))-S(\d{2})–S(\d{2})", text):
        refs.update(f"{ws}-S{k:02d}" for k in range(int(a), int(b) + 1))
    return refs


def milestone(task_id: str) -> int:
    part = task_id.split("-")[1]
    return 9 if part.startswith("S") else int(part[0])


def dependency_graph() -> dict[str, set[str]]:
    """Task ID → the task IDs its Depends on line names."""
    graph: dict[str, set[str]] = {}
    for block in re.split(r"^#### ", PLAN.read_text(encoding="utf8"), flags=re.M)[1:]:
        tid = block.split(" ")[0]
        dep_line = re.search(r"\*\*Depends on:\*\* (.*)", block)
        graph[tid] = expand_refs(dep_line.group(1)) if dep_line else set()
    return graph


def critical_path(tiers: dict[str, str]) -> list[str]:
    """Longest chain of Must tasks through their dependencies, counting each task as one step."""
    graph = dependency_graph()
    best: dict[str, list[str]] = {}

    def longest(tid: str) -> list[str]:
        if tid not in best:
            chains = [longest(dep) for dep in sorted(graph.get(tid, ())) if tiers.get(dep) == "Must"]
            best[tid] = max(chains, key=len, default=[]) + [tid]
        return best[tid]

    # Sorted, so ties always resolve to the same chain.
    return max((longest(t) for t in sorted(tiers) if tiers[t] == "Must"), key=len, default=[])


def check_plan() -> dict[str, str]:
    text = PLAN.read_text(encoding="utf8")
    headings = TASK_HEADING.findall(text)
    tiers = {tid: tier for tid, _, tier in headings}
    ids = [tid for tid, _, _ in headings]

    if len(ANY_TASK_HEADING.findall(text)) != len(headings):
        fail("plan.md: a task heading doesn't match '#### <ID> · <title> · Must|Should'")
    for tid in {i for i in ids if ids.count(i) > 1}:
        fail(f"plan.md: duplicate task ID {tid}")

    blocks = re.split(r"^#### ", text, flags=re.M)[1:]
    for block in blocks:
        tid = block.split(" ")[0]
        if tid not in tiers:
            continue
        for field in ("**Files:**", "**Depends on:**", "**Done when"):
            if field not in block:
                fail(f"plan.md: {tid} has no {field}")
        dep_line = re.search(r"\*\*Depends on:\*\* (.*)", block)
        deps = expand_refs(dep_line.group(1)) if dep_line else set()
        for dep in sorted(deps):
            if dep not in tiers:
                fail(f"plan.md: {tid} depends on undefined {dep}")
                continue
            if milestone(dep) > milestone(tid):
                fail(f"plan.md: {tid} depends on {dep}, from a later milestone")
            same_list = dep[:2] == tid[:2] and milestone(dep) == milestone(tid) and milestone(tid) != 9
            if same_list and dep > tid:
                fail(f"plan.md: {tid} depends on {dep}, which comes later in its own list")
            if tiers[tid] == "Must" and tiers[dep] == "Should":
                fail(f"plan.md: Must task {tid} depends on Should task {dep}")

    flow_map = re.search(r"## Flow map(.*?)\n---", text, re.S)
    if not flow_map:
        fail("plan.md: no '## Flow map' section")
    else:
        mapped = expand_refs(flow_map.group(1))
        for tid, tier in tiers.items():
            if tier == "Must" and tid not in mapped:
                fail(f"plan.md: Must task {tid} isn't in the flow map")
            if tier == "Should" and tid in mapped:
                fail(f"plan.md: Should task {tid} appears in the flow map")
    return tiers


def check_references(tiers: dict[str, str]) -> None:
    docs = [PLANNING / "design.md", PLANNING / "checklist.md", PLANNING / "README.md", ROOT / "AGENTS.md", PLAN]
    for doc in docs:
        if not doc.exists():
            continue
        for n, line in enumerate(doc.read_text(encoding="utf8").splitlines(), 1):
            for ref in sorted(expand_refs(line)):
                if ref in tiers:
                    continue
                if ref in RETIRED and RETIRED[ref] in line:
                    continue
                fail(f"{doc.relative_to(ROOT)}:{n}: references undefined task {ref}")


# Mirrors .gitignore: planning/ is tracked except its decision records and the original master plan.
IGNORED_TOPS = {"skills", ".git", ".claude", ".codex", ".agents", ".superpowers"}
IGNORED_PATHS = {"planning/adr", "planning/master-plan.docx"}
IGNORED_EVERYWHERE = {"AGENTS.md", "CLAUDE.md"}
MARKDOWN_LINK = re.compile(r"\]\(([^)#\s]+)")


def is_ignored(rel: str) -> bool:
    """True when a repo-relative POSIX path falls under a gitignored local path."""
    parts = rel.split("/")
    return (
        parts[0] in IGNORED_TOPS
        or parts[-1] in IGNORED_EVERYWHERE
        or any(rel == p or rel.startswith(p + "/") for p in IGNORED_PATHS)
    )


def tracked_files() -> list[Path]:
    """Files that git would track: everything outside the gitignored local paths."""
    # Gitignored anywhere in the tree; pruned so the walk never enters them.
    ignored_dirs = {"node_modules", ".venv", ".next", "__pycache__", ".pytest_cache", ".ruff_cache", ".temp", ".branches"}
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        here = Path(dirpath)
        dirnames[:] = [
            d
            for d in dirnames
            if d not in ignored_dirs
            and not (here == ROOT and d in IGNORED_TOPS)
            and (here / d).relative_to(ROOT).as_posix() not in IGNORED_PATHS
        ]
        for name in filenames:
            path = here / name
            rel = path.relative_to(ROOT).as_posix()
            if name in IGNORED_EVERYWHERE or rel in IGNORED_PATHS:
                continue
            if name.startswith(".env") and name != ".env.example":
                continue
            files.append(path)
    return files


def check_tracked_links() -> None:
    for path in tracked_files():
        if path.suffix.lower() not in {".md", ".ts", ".tsx", ".js", ".mjs", ".py", ".sql", ".json", ".yml", ".yaml", ".toml", ".txt"}:
            continue
        text = path.read_text(encoding="utf8", errors="ignore")
        rel = path.relative_to(ROOT)
        in_planning = rel.parts[0] == "planning"
        if path.suffix.lower() == ".md":
            # Prose may name gitignored paths (to say they're ignored); links must not point into them.
            for target in MARKDOWN_LINK.findall(text):
                if "://" in target:
                    continue
                try:
                    target_rel = (path.parent / target).resolve().relative_to(ROOT).as_posix()
                except ValueError:
                    continue
                # Planning docs link to adr/ and the master plan; those resolve in local checkouts.
                if in_planning and target_rel.startswith("planning/"):
                    continue
                if is_ignored(target_rel):
                    fail(f"{rel}: links to {target_rel} (gitignored)")
            if path.parent == ROOT and re.search(r"\b(AGENTS|CLAUDE)\.md\b", text):
                fail(f"{rel}: tracked root file mentions AGENTS.md or CLAUDE.md (gitignored)")
        elif not in_planning:
            # Code and config never depend on local-only files.
            for folder in ("planning/adr/", "skills/"):
                if re.search(r"(^|[\s(\"'`/])" + re.escape(folder), text):
                    fail(f"{rel}: tracked file refers to {folder} (gitignored)")


def check_text_hygiene() -> None:
    docs = sorted(PLANNING.rglob("*.md")) + [ROOT / "AGENTS.md", ROOT / "README.md"]
    for doc in docs:
        if not doc.exists():
            continue
        rel = doc.relative_to(ROOT).as_posix()
        text = doc.read_text(encoding="utf8")
        in_section_11 = False
        for n, line in enumerate(text.splitlines(), 1):
            if doc.name == "design.md" and line.startswith("## "):
                in_section_11 = line.startswith("## 11.")
            for number in PHONE.findall(line):
                if number != PHONE_PLACEHOLDER:
                    fail(f"{rel}:{n}: phone number other than the placeholder")
            if CAST_NAMES.search(line) and not (doc.name == "design.md" and line.startswith("**Cast names.**")):
                fail(f"{rel}:{n}: personal cast name")
            if in_section_11 or LOGISTICS_ALLOWED.search(line) or rel == "planning/adr/0002-pre-event-work-policy.md":
                continue
            for pattern in LOGISTICS:
                match = pattern.search(line)
                if match:
                    fail(f"{rel}:{n}: event logistics '{match.group(0)}'")


def main() -> int:
    # Windows consoles default to cp1252, which can't print the arrows below.
    sys.stdout.reconfigure(encoding="utf-8")
    tiers = check_plan()
    check_references(tiers)
    check_tracked_links()
    check_text_hygiene()
    musts = sum(1 for t in tiers.values() if t == "Must")
    print(f"{len(tiers)} tasks: {musts} Must, {len(tiers) - musts} Should")
    path = critical_path(tiers)
    print(f"Longest dependency chain ({len(path)} Must tasks): {' → '.join(path)}")
    # One engineer works serially, so per-person Must load bounds each milestone too.
    print("Must tasks per engineer and milestone:")
    for ms in (1, 2, 3, 4):
        counts = {ws: sum(1 for t, tier in tiers.items() if tier == "Must" and t.startswith(ws) and milestone(t) == ms)
                  for ws in ("FE", "AI", "CO", "VO")}
        print(f"  M{ms}: " + ", ".join(f"{ws} {n}" for ws, n in counts.items()))
    if failures:
        print(f"{len(failures)} problem(s):")
        for message in failures:
            print(f"  - {message}")
        return 1
    print("All planning checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
