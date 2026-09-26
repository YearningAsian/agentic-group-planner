# Planning docs

These docs describe the product and how to build it. They're tracked, except `adr/` and `master-plan.docx`, which are gitignored and live only in local checkouts. Links to them resolve only there.

## Read in this order

1. [`design.md`](design.md) §5, **Core user flows**: the five things the product does, with sequence diagrams.
2. [`design.md`](design.md) §1 (module map and ownership), then the sections your workstream's row points to.
3. [`plan.md`](plan.md): your tasks, their tiers, files, dependencies, and tests.
4. [`adr/`](adr/README.md) before reopening any decision.
5. [`checklist.md`](checklist.md) when setting up accounts or running the scaffold.

## What each doc is for

| Doc | Purpose |
| --- | --- |
| [`design.md`](design.md) | The technical design: core flows, contracts, data model, state machines, Realtime, reliability, frontend, env, and seed data. §11 logs every deviation from the master plan and every review ruling. |
| [`plan.md`](plan.md) | The build plan: four milestones, tasks per workstream (tiered Must or Should against the core flows), who works on what, and the critical path. |
| [`progress.md`](progress.md) | The running log of backend and data work: each feature's commits, the proof behind each status in `plan.md`, and what's blocked. |
| [`stack.md`](stack.md) | Pinned versions. Verify them on npm and PyPI before installing. |
| [`checklist.md`](checklist.md) | Account and key setup, then the scaffold steps in order. |
| [`adr/`](adr/README.md) | Architecture decision records. Gitignored. |
| [`master-plan.docx`](master-plan.docx) | The master plan, Sep 23 revision, unedited. Gitignored. Its event sections (positioning, judging, timeline, demo script, and pre-event checklist) no longer apply; see design §11.2. |
| [`tools/`](tools/) | Planning scripts: `check_plan.py` checks the docs for consistency, and `docx_text.py` prints a .docx file as plain text. |

## Checks

Run from the repo root after editing any planning doc:

```bash
python planning/tools/check_plan.py
```

It checks that task IDs resolve, that dependencies point backward, that no Must task depends on a Should task, and that every Must task maps to a core flow. It also prints the longest dependency chain and each engineer's Must load per milestone (plan.md, Critical path). It also checks that tracked files outside `planning/` don't refer to the gitignored `planning/adr/` or `skills/`, and that no personal names, real phone numbers, or event logistics crept back in.
