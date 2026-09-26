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

### Feature 3 (part 1) · Run queue and the send-message route

| Commit | What | Proof |
| --- | --- | --- |
| `feat(agent): one running run per trip with a queue` | AI-212: `sweepTrip`, `nextQueuedRun`; the runner sweeps, claims, runs, then drains | db `run-queue.test.ts` 4 passed (RED first on all three behaviors) |
| `fix(db): keep a message's item and reply on its own trip` | migration `20260926071157_messages_same_trip_links.sql` | db `send-message.test.ts`, the policy case (RED first: a cross-trip comment was accepted) |
| `feat(chat): idempotent send-message route that starts agent runs` | FE-105: `sendMessage`, `mentionsAgent`, `POST /api/messages` | db 6 passed; unit 7 passed (RED first: stub and missing route) |

### Reviews before merging into `testing`

Two independent reviewers, one per branch, each in its own worktree:

- **`feat/agent-llm-provider` (AI-104): mergeable after fixes.** The blocking finding was that a model's invalid tool call (bad input or an unknown tool) ended the run with a bare string instead of going back to the model. Fixed in `fix(agent): let the model correct bad tool calls, and fail runs at the cap`, which also covers the 90 s timeout as `AppError timeout`, the step cap failing the run (design §4.4), and the mock's abort, key, and file-name checks. Deferred: tools aren't raced against the run budget (the lease and sweep bound it).
- **`colin-data-backend`: mergeable after one fix.** The blocking finding was that the SDK validated tool input, so `runTool` never recorded bad input and the model never saw `invalid_input`. Fixed in `fix(agent): runTool validates tool input, and the runner trusts finish`, which also covers finish results, a shared and saved handle table (`addHandle`), `actorMemberId` in `RunContext`, and a lost insert race.

Gates after the fixes: shared 32, web unit 83, db 11 files / 57 passed, optimizer 5, lint, typecheck, `check_plan.py`, and gitleaks all clean.

### Merged into `testing`

PR #2 (`colin-data-backend`) merged into `testing` with a merge commit, `f1885fb`. PR #1 (`feat/agent-llm-provider`) was retargeted to `testing` and closed as merged, since its head is in #2. The branch then fast-forwarded to `testing`.

### Feature 3 (part 2) · The `plan_day` slice and the seed

| Commit | What | Proof |
| --- | --- | --- |
| `feat(agent): plan_day end to end through the optimizer` | AI-107: `createOptimizerClient`, `buildPlanRequest` (first version), `plan_day` with constraint updates | unit 5, db 1 (RED first); contract check against the real FastAPI stub |
| `feat(demo): idempotent seed with batches and a stable invite token` | VO-105: `seed.ts`, fixtures, `args`, `time`, root and web `seed:demo` | unit 9, db 5; `seed:demo --batch dev-vo` twice, identical counts |

M1 slice, server side, on a seeded trip: the recorded plan prompt, the mock LLM, the real `plan_day`, the FastAPI stub, and the database gave a `succeeded`, `replayed` run with one plan card. The browser half (Realtime in two sessions) and the real-model half (`LLM_PROVIDER=meta` needs `META_MODEL_API_KEY`) are still open.

### Parallel worktrees, round 1

| Worker | Tasks | Result |
| --- | --- | --- |
| commerce | CO-201, CO-202, CO-203, CO-204, VO-203, CO-207 | 7 commits, merged in `74640f3`; after `supabase db reset`: shared 41, web unit 110, db 15 files / 79 passed; types regenerated with no diff |
| optimizer | AI-202 to AI-206 | running |

The commerce worker's follow-ups:
- `rpcError` is duplicated in `create-mandate.ts`; it could move to `lib/reliability`.
- `PaymentsEvent` needs metadata for CO-209 and CO-212.
- Price-change re-approval (CO-S01) needs a `create_mandate` variant without a tool call.
- The `lib/reliability` barrel is server-only now that it exports the webhook ledger; no client module imports it.
