# Progress log

A running log of backend and data work: what was done, the proof, and what's blocked. Task status of record lives in [`plan.md`](plan.md); this file says how each status got there. Newest session last.

## 2026-09-26 · Backend and data session

Branch: `colin-data-backend` (cut from `testing`, which is `main` plus the frontend prototype). Environment: a Linux cloud container with Node 22 (the repo wants 24; pnpm warns and works), Python 3.12 in `optimizer/.venv`, and the local Supabase stack in Docker (images from Docker Hub).

### Recovery

- The interrupted session left a clean tree. Its work, AI-104, was already pushed as `feat/agent-llm-provider` with a draft PR (#1 in this repo). `colin-data-backend` merges that branch, so the runner can build on it; nothing was stashed or reset.
- There was no `planning/progress.md`; this file starts here.
- `pnpm -r typecheck` needs the Next.js route types first: run `pnpm --filter web exec next typegen` once after a fresh clone (`LayoutProps` is generated).
- Baseline before any change: typecheck, lint, 39 web unit tests, 31 shared tests, 5 optimizer tests, and 28 database tests (local stack) all passed; `check_plan.py` passed.

### Feature 1 · Align the code with the journey pivot

The pivot (design §11.6) was docs only, so the code still had 7 tools, 11 card types, the call, photo, and vote enums, the gallery, recap, and voice features, their providers and env variables, and the `votes` and `calls` tables. AI-102, AI-103, and VO-103 no longer met their own Done-when lists.

| Commit | What | Proof |
| --- | --- | --- |
| `feat(db): drop pivot-removed tables and narrow enum checks` | migration `20260926063958_journey_pivot_cleanup.sql`; schema tests updated; types regenerated | `tests/db/pivot-cleanup.test.ts` 4 passed (RED first: tables present, old values accepted); `supabase db reset` then `test:db` → 7 files, 31 passed |
| `feat(shared): contracts and entry points for the five-flow journey` | enums, tools, cards, api barrel; web registry, card map, features, providers | shared 32 passed, web tools 4 passed (RED first on 27 enums, 7 tools, 11 cards, and the api barrel) |
| `refactor(env): drop the variables for flows the pivot removed` | env loader, LLM provider (`describeImage`, vision model), env examples | `src/lib/env` 9 passed (RED first: all cases, on `VOICE_PROVIDER`) |
| `chore(deps): drop the call and photo packages` | web: `@elevenlabs/elevenlabs-js`, `exifr`; optimizer: `imagehash`, `pillow`, `pywavelets`, `scipy` | fresh venv: `uv pip check` clean, pytest 5 passed |
| `fix(agent): stop asking the group to vote` | `plan_day` description, `applyPlan` summary, plan recording | copy test (RED first on the three strings), web 61 passed, `apply-plan` db 5 passed |

Frontend impact: `cards.tsx` no longer maps `call_status` or `recap`; the feature barrels lost `VoteButton`, `GalleryView`, `RecapView`, and `CallStatusCard` (null stubs); `features/profile` and `features/itinerary` gained `ProfileForm`, `CommentThread`, and `MyItineraryView` stubs.

### Feature 2 · Agent context and runner

| Commit | What | Proof |
| --- | --- | --- |
| `feat(agent): trip context with stable handles` | AI-105: `assignHandles`, `resolveHandle`, `renderContext`, `loadTripSnapshot`, `buildContext`, the standing prompt | unit 14 passed (RED first: missing modules); db `agent-context.test.ts` 2 passed |
| `feat(db): finish_agent_run write function` | migration `20260926070135_finish_agent_run.sql`; types regenerated | covered by `runner.test.ts` (non-member, idempotent, client refused) and the definer audit |
| `feat(agent): runner with leases, idempotent tool calls, and status broadcasts` | AI-106: `claimRun`, `startAgentRun`, `runTool`, `supabaseBroadcast` | db `runner.test.ts` 11 passed (RED first: missing runner); web unit 71, db 9 files / 44 passed |

Decision: a run's end (message plus status) is one write function, `finish_agent_run`, added to design §3.4, so a crash can't split them.
