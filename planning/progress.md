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

### Round 2 (lead): CI, seed stages, reset, and the itinerary export

| Commit | What | Proof |
| --- | --- | --- |
| `ci: lint, typecheck, tests, pytest, and contracts drift` | CO-106 | lint 6 passed (RED first); three jobs green on GitHub (PR #3) |
| `feat(demo): seed stages for isolated development` | VO-201 | args 3 listed tests pass |
| `feat(demo): batch reset under 30 seconds` | VO-216 | reset-plan 3, db 1; `reset:demo --batch dev-vo` 0.3 to 1.1 s |
| `feat(shared): one share status for every money surface` | `shareStatus` (FE-404, CO-213) | shared 5 passed |
| `feat(itinerary): per-person itinerary export and calendar download` | FE-404, backend half | unit 7, db 2 |
| Merge `AI-202 to AI-206` | the optimizer engines, from a parallel worktree | pytest 57 passed, ruff clean |
| `feat(optimizer): send each slot's category to the engines` | the regenerated OpenAPI types | the real engines ran the seeded plan prompt end to end |
| `fix(demo): a re-seed keeps constraints the trip has since changed` | review follow-up | db seed 5 passed (RED first) |

The batch 2 review (`f1885fb..b79eb46`) found the range **mergeable as is**, with non-blocking follow-ups:
- the webhook ledger, the mock webhook secret, and create_mandate's tests and hardening went to the commerce worker;
- `plan_day`'s $0 fallback, the rounded summary prices, and a slice-test assertion went to the AI worker;
- the seed's constraint revert I fixed myself.

### Round 3 (lead and workers): voice, prompt, summarize, and the VO backend

| Commit | What | Proof |
| --- | --- | --- |
| `feat(agent): record real runs for tests` | AI-213 | unit recorder tests (RED first) |
| `feat(voice): voice notes through meta speech to text` | VO-S03 | unit and route tests |
| `feat(agent): tune the system prompt for muse spark` | AI-301 (prompt; the real-model check needs `META_MODEL_API_KEY`) | `prompt.test.ts` |
| `feat(agent): summarize tool` | AI-S02 | unit 4 (RED first: no `buildSummary`), db 2 |
| Merge VO backend | VO-107 health, VO-106 confirm and `demoSignIn`, VO-209 `claim_invite`, VO-220 profile update | after `supabase db reset`: typecheck and lint clean; shared 46, web unit 163, db 20 files / 96 passed |
| `fix(auth): land failed magic links on / until the login page exists` | the dead-link check (`routes.test.ts`) failed on `/login?error=link` | unit route tests |
| `chore(db): regenerate types from this branch's migrations` | the VO branch's types held another worker's column | `pnpm db:types` after a clean reset |

The integration reset wiped the other workers' psql-applied migrations from the shared local stack; the lead re-applied their pending files (commerce: `payment_holds_lease`, `create_mandate_hardening`, `complete_mandate`; AI: `apply_plan_splits`) right after, and told both workers.

### Round 3, continued: update_item, and the AI and commerce merges

| Commit | What | Proof |
| --- | --- | --- |
| `feat(db): apply_item_change for update_item` and `feat(agent): update_item tool` | AI-216 (`request_alternatives` waits on AI-210) | db 6 (RED first); a mutant without the organizer check failed |
| Merge AI planning | FE-209, AI-201, AI-207, AI-209 (split siblings, reasoning, exact prices) | worker: unit 142, db 19 files / 92 |
| `refactor(money): one formatUsd and one rpcError` | two `formatUsd`s disagreed on thousands separators; `rpcError` had three copies | unit 179 |
| Merge commerce round 2 | CO-208, CO-209, CO-210, CO-212, and the batch 2 review fixes | after `supabase db reset`: typecheck and lint clean; shared 46, web unit 192, db 29 files / 143; pytest 57, ruff clean; `api:types` no diff |

The batch 3 review (`b79eb46..58deb6b`, with engine fuzzing against a brute force) found the range **mergeable as is**, with five non-blocking findings:
- the enumeration fallback reports `infeasible` when it times out, and CP-SAT's thousandths rounding can break near-ties differently from enumeration: both went to the AI worker;
- `reset:demo` drops `--stage`, and a failed user delete leaves the batch with no trip: the lead fixes these;
- the import-boundary lint rules only see `@/` alias imports: a follow-up (every server module imports `server-only`, so `next build` still catches client leaks).

### Round 4 (commerce worker and lead): finalization retries, fronted refunds, database CI

Logged at the next session's recovery; these commits were pushed without an entry.

| Commit | What | Tasks |
| --- | --- | --- |
| `fix(demo): reset keeps --stage, and a failed user delete still re-seeds` | batch 3 review follow-up | VO-216 |
| `fix(lint): hold relative and dynamic imports to the boundary rules` | batch 3 review follow-up: one rule resolves every import to its `@/` path | CO-106 |
| `feat(payments): persist finalization quote for retries` | migration `20260926120000_finalize_quote.sql` | CO-210, CO-S01 |
| `fix(payments): refund stored fronted capture portions` | each fronted row refunds its own stored capture portion | CO-212 |
| `fix(payments): keep finalization on the approved quote` | a price or currency change cancels and releases an unbooked mandate | CO-210, CO-212 |
| `ci: run database and mock payment suites` | an isolated local Supabase stack on Ubuntu; DB suites and DB types drift | VO-108, CO-210, CO-212 |
| `test(optimizer): stabilize the solver time-budget assertion` | the budget check uses the small table, which can't return UNKNOWN under load | AI-206 |
| `feat(payments): persist confirmed booking before capture` | migration `20260926121000_persist_booked_merchant.sql` | CO-210 |
| `fix(payments): resume confirmed bookings without rebooking` | a retry resumes the saved booking or an unfinished release | CO-210 |

PR #3's four CI jobs (web and shared, optimizer, database and mock payments, contracts drift) were green at `6be77d6`.

## 2026-09-26 · Recovery session (Windows)

Environment: Windows, PowerShell, Node 26, Python 3.12 in `optimizer/.venv`. Docker Desktop's Linux engine didn't start (WSL hung), so no local Supabase: DB and RLS proofs come from CI's "database and mock payments" job. About 1.5 GB of RAM was free, so work ran with at most one helper agent at a time.

### Recovery

- The prompt's recovery notes were stale. PRs #1 and #2 were already merged into `testing` (`f1885fb`), and PR #3 (`colin-data-backend` → `testing`, draft) held 75 more commits, all CI green. FE-105 and the same-trip message policy were done and merged in #2; the price source was settled in design §11.7 item 1.
- Four sibling worktrees (`agentic-group-planner-{late-auth,refund,seeded,stripe}`) were folded back and deleted:
  - `refund` (`fix/fronted-refunds`): already merged; clean.
  - `late-auth` (`fix/late-authorization`): an uncommitted CO-209 fix and test. RED confirmed by setting the fix aside (2 failed), GREEN with it; committed there, then cherry-picked.
  - `seeded` (`test/seeded-optimizer`): an untracked AI-208 test; committed there. It fails (see below), so it stays off `colin-data-backend`.
  - `stripe` (`feat/stripe-provider`): one committed CO-301 commit, cherry-picked.
  - All three branches were pushed to `origin` before the folders were removed.
- `feat/payments-money-and-mocks` (a WIP money commit) and `feat/optimizer-score-table` hold older versions of work that landed differently on `colin-data-backend`; left in place, not merged.
- `web/.env.local` differs from `web/.env.example`. Missing: `META_MODEL_API_KEY`, `META_MODEL_API_BASE_URL`, `TRANSCRIBE_PROVIDER`, `TRANSCRIBE_MODEL`, and `DEMO_SEED_SECRET`. Still present, though removed from the example: `VISION_MODEL`, `XAI_API_KEY`, the `VOICE_*` and `ELEVENLABS_*` keys, and `DEMO_SEED_PASSWORD`. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are empty, and there's no `web/.env.test.local`.

### Feature 4 · Recovered payments work

| Commit | What | Proof |
| --- | --- | --- |
| `fix(payments): release late holds only when no row pays a share` | CO-209 follow-up | `approve-hold.test.ts` 2 passed (RED first: both failed) |
| `feat(payments): add Stripe test-mode provider` | CO-301 | `src/lib/providers/payments` 16 passed; API version equals the SDK's |

Gates at `eb6a793`: typecheck and lint clean; shared 46, web unit 213; ruff clean, pytest 57; `check_plan.py` passed.

### Feature 5 · AI-208: repeats fixed, target plan blocked

| Commit | What | Proof |
| --- | --- | --- |
| `feat(optimizer): stop a member visiting a place twice in a day` | both engines and `is_feasible`; a tighter enumeration bound | `test_repeats.py` 14 passed (RED first: 11 failed); pytest 71 |

- The first version of the enumeration change ran out of time at the engine limits when slots shared places: seed 11 found no plan in 10 s. A bound that skips visited places, plus removing each member's pinned places from their open choices, brought every measured case to 0.6 s or less, matching CP-SAT. `test_enumeration_finishes_at_the_limits_when_places_repeat` pins it.
- **Blocked:** the §10.2 target plan. Three tuning rounds (weights, tags, interests, prices) reached it only with the `cost` weight at 0.1. Evidence and options are in design §11.7, item 6. Next step: a product decision among those options.
