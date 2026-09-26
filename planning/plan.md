# Group Trip Agent — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five core user flows in [design §5](design.md#5-core-user-flows): create profile, AI-guided trip planner, invite and collaborate, group pay after confirmation, and per-person itinerary. Build the development and test tooling around them.

**Architecture:** A pnpm monorepo. The Next.js 16 app holds the chat, lanes, map, payments, profile, per-person itinerary, and an agent runner with 5 tools. `@agp/shared` holds the Zod contracts. A stateless FastAPI service runs CP-SAT and the enumeration fallback. Supabase provides Postgres with RLS and Realtime. Cards are message rows, and Realtime only triggers refetches. Every provider has a real adapter and a mock one, and the mock is for development and tests only.

**Tech stack:** pinned in [`stack.md`](stack.md), and re-verified before installing.

**Spec:** [`design.md`](design.md) (Phase 3 review applied, 2026-09-23). Design §11 records every review ruling this plan implements.

**Status:** Phase 3 revision, 2026-09-23. [ADR 0002](adr/0002-pre-event-work-policy.md) is withdrawn, so code appears where it pins down a rule better than prose.

## How to use this plan

- **Milestones.** Four milestones, each with pass/fail criteria. Within a milestone, tasks are grouped by workstream and listed in dependency order.
- **Task IDs.** `<workstream>-<milestone><nn>`: FE-204 is Frontend, Milestone 2, task 4. Should-queue tasks are `<workstream>-S<nn>`. IDs are stable across revisions, so tasks removed in the Phase 3 review leave gaps.
- **Team roles.** Teammates are named by workstream: the **FE**, **AI**, **CO**, and **VO** engineers (Frontend; Agent and ML; Commerce; Voice, media, and operations). "Person 1" through "Person 4" always mean the seeded cast, never a teammate.
- **Tiers.** A task is **Must** only if a core user flow fails without it ([flow map](#flow-map)). That includes the foundation every flow runs on, and the test doubles that Must tasks' own tests need. Everything else is **Should**: dev tooling, CI, e2e suites, audits, and feature extensions.
  - A Must task never depends on a Should task. `planning/tools/check_plan.py` enforces this.
  - Within a milestone, do the Must tasks first. Pick up a Should task when it speeds up Must work (seed stages, e2e), or once the milestone's Must tasks pass.
  - The [Should queue](#should-queue) at the end holds feature extensions.
- **Size.** Aim for 30 minutes per task. If a task passes 45 minutes, commit what's green, then split the rest into a new task with the same ID plus a letter (AI-205b).
- **Tracking.** Tick a task's boxes as each passes, and tick a milestone's criteria in this file when they pass.

## Global constraints

Every task's requirements include these. Values are copied from the design.

- **Versions:** Node ≥ 24, pnpm 11, TypeScript **6.0.3** (not 7), Python 3.12. Every package is pinned exactly (`--save-exact`) to the versions in `stack.md`, after the registry check.
- **Cast labels:** display names are exactly `Person 1`, `Person 2`, `Person 3`, and `Person 4`, in seed data, prompts, recordings, card copy, and tests. The repo contains no personal names for the cast.
- **Money:** integer cents, computed on the server only. The model never supplies a charged amount, and never writes a number of its own onto a card.
- **Statuses only move forward.** Use conditional updates (`… where status in (<allowed predecessors>)`), so duplicate or late events become no-ops (design §4).
- **Multi-row writes** go through the design §3.4 write functions only. Each function:
  - checks that its `actor_member_id` is a joined member of the trip that owns every row it touches;
  - pins `search_path` if it's `security definer`;
  - ships with a database test showing a non-member call is rejected.
- **External calls** go through a provider adapter and `withPolicy`. A failure becomes an error card with Try again, never a silent switch to a mock.
- **Idempotency keys** are exactly the ones in design §7.1. Webhooks read the raw body, verify the signature, and record in `webhook_events` before processing.
- **Imports:** no deep imports across features. Server-only modules start with `import 'server-only'`.
- **Tracked files never depend on local-only files.** `planning/adr/`, `planning/master-plan.docx`, `skills/`, and `AGENTS.md` are gitignored: code never refers to them, and no tracked doc outside `planning/` links to them.
- **UI:** mobile first. Targets are at least 44 × 44 px. Use design tokens only (design §8.2). Every control has hover, active, focus-visible, disabled, and pending states. Lane colors never carry meaning alone; always show initials too.
- **Test data:** database tests use a `test:<uuid>` seed batch and delete their trips afterward. e2e runs use `e2e-<random>`. Each engineer develops in their own batch (`dev-fe`, `dev-ai`, `dev-co`, `dev-vo`). The `demo` batch is for checks on the deployed app.
- **CI** runs with every provider mocked and needs no real keys.
- **Payments concurrency suites** (`web/tests/payments/`) are provider-agnostic. They run on mocks with `test:db`, and on Stripe test mode with `test:stripe` (CO-305). Both must pass.
- **Comments** explain why, not what. Public functions get TSDoc or docstrings.

## The task loop

Every task follows the same loop. It applies the repo's `superpowers` (TDD), `spartan-ai-toolkit` (quality gates), and `git-guardrails` skills. UI tasks also follow `frontend-design` and `vercel-react-best-practices`. A task touching 3 or more files keeps a `task_plan.md` at the repo root (`planning-with-files`; it's tracked, so keep it free of secrets).

1. Write the tests named under **Done when**.
2. Run them, and see each one fail for the reason you expect.
3. Write the least code that makes them pass.
4. Run them again, and see them pass.
5. Run the gates in this order: `pnpm -r typecheck`, then `pnpm -r lint`, then `pnpm -r test`. If `optimizer/` changed, also run `ruff check` and `pytest`.
6. Do the **Check** step, if the task has one.
7. Run `git status --short`, inspect the staged diff, and commit with the task's Conventional Commit message. Then `git pull --rebase` and push. Never force-push `main`.

## Commands

| What | Command |
| --- | --- |
| Web unit tests | `pnpm --filter web test -- <file>` (Vitest, `unit` project) |
| Database tests | `pnpm --filter web test:db -- <file>` (Vitest, `db` project, against the linked dev Supabase project; not run in CI) |
| Stripe test-mode tests | `pnpm --filter web test:stripe -- tests/payments` (Vitest, `stripe` project: real Stripe test key and the dev Supabase project; not run in CI) |
| e2e | `pnpm --filter web e2e -- <file>` (Playwright, mocks, against the local dev server) |
| Shared contracts | `pnpm --filter @agp/shared test -- <file>` |
| Optimizer | `cd optimizer && pytest tests/<file>.py` |
| Seed or reset a batch | `pnpm seed:demo --batch <name> [--stage planned\|discussed\|booked]` · `pnpm reset:demo --batch <name>` (added by VO-105 and VO-216) |
| Regenerate types | `pnpm db:types` after a migration · `pnpm api:types` after an optimizer model change |
| Check the planning docs | `python planning/tools/check_plan.py` |

## Review focus

These five conditions are implied by the design but easy to miss, and each would hurt a person using the app. Each one has a test in the task that owns the code.

1. **Double taps and concurrent requests** on Send, Comment, Approve, and Join must produce exactly one message, comment, authorization, booking, or claim. Tests: FE-106, FE-220, CO-209, CO-210, VO-210.
2. **Duplicate or out-of-order callbacks.** Stripe can send an event twice, or before our own update commits. Each still gets one outcome, one booking, one capture, and one refund. Tests: CO-209, CO-210, CO-212, with CO-305 on Stripe test mode (payments).
3. **A member backgrounded or offline mid-flow** (mobile browsers pause sockets) must catch up on return. A member who missed an approval card must still see it. Tests: FE-214.
4. **An invite link used twice**, whether on two devices or after it was claimed, must show a clear state and never claim twice. Tests: VO-209, VO-210.
5. **Person 4 in any order.** Claiming before capture, after capture, never, or claiming then declining, plus a retried settlement, must never double-charge or double-refund. Each share is paid by exactly one hold. Tests: CO-210, CO-212, and CO-305 on Stripe test mode.

## Ownership and collision rules

Four people commit to `main` in parallel. These rules keep any two of them from editing the same file in the same milestone.

1. **Barrels are frozen after Milestone 1.** AI-102 and AI-103 create every barrel with its final export names: `packages/shared/src/{index,tools/index,cards/index,api/index}.ts`, `web/src/lib/tools/registry.ts`, and every `web/src/features/*/index.ts` and `server.ts`. FE-104 creates `web/src/lib/tools/cards.tsx`. Afterward, owners replace the stub implementations behind those exports and don't edit the barrels.
2. **Dependencies.** After FE-102, only the VO engineer changes `package.json` files and `pnpm-lock.yaml`. Ask in the team chat, and VO adds dependencies in one batch. Every environment variable in design §9 is added in VO-103, so nobody else edits `lib/env`.
3. **Generated files** (`database.types.ts`, `openapi.ts`) are never hand-merged. On a conflict, run `pnpm db:types` or `pnpm api:types` and commit the result.
4. **Migrations.** The Milestone 1 files have fixed names (design §3.3), each with one author. Later files come from `supabase migration new` and belong to the table's owner. Push in timestamp order. If the CLI reports an out-of-order file, give your unpushed file a new timestamp.
5. **One file, one owner.** Anything shared is split into files: fixtures, recordings, seed stages, and e2e specs each have their own file and owner (table below).
6. **Crossing workstreams means importing, never editing.** For example, FE's `ItemBlock` renders CO's `ShareStatusBadge`, and VO's confirm route calls CO's `recordReservation`.

| Shared area | Files and owners |
| --- | --- |
| Seed fixtures (`web/scripts/demo/fixtures/`) | `users.ts` VO · `saturday-trip.json` VO in M1, then AI (planner tuning) · `mock-plan.json` AI · `routes.json` FE |
| Agent recordings (`fixtures/agent-recordings/`) | plan prompt AI · `collaborate-make-lunch-cheaper.json` AI · `book-the-aquarium.json` CO |
| Seed stages (`web/scripts/demo/stages/`) | `index.ts` VO · `planned.ts` AI · `discussed.ts` FE · `booked.ts` CO |
| e2e (`web/e2e/`) | harness (`global-setup.ts`, `fixtures.ts`, config) VO · `01-plan` AI · `02-collaborate` FE · `03-pay` CO · `04-claim` VO · `05-itinerary` FE · `00-all-flows` FE · `a11y` FE |
| Trip view (`web/src/lib/trip-view/`) | FE: the view model, its fixtures, `buildTripView`, and `useTripView`. The lanes and the map import it, and never edit it. |
| Itinerary (`features/itinerary/`) | components FE · `server/apply-plan.ts`, `server/supersede-item.ts` AI (CO writes the first `apply-plan.ts` in M1) |
| Payments and booking UI | `features/payments/components/approval-card.tsx`, `features/payments/lib/approval-copy.ts`, `features/payments/hooks/use-mandates.ts`, `lib/tools/propose-purchase/card.tsx`, and `features/booking/components/booking-confirmed-card.tsx` VO (VO-213, VO-214) · the rest of payments and booking CO |
| Payments concurrency suites (`web/tests/payments/`) | CO |
| Tool folders (`web/src/lib/tools/`) | `plan-day`, `search-places`, `update-item`, `summarize` AI · `propose-purchase` CO |
| `/api/demo/[action]` (dev tooling) | VO; each action calls the owning feature's exported function |

---

## Milestone 1: scaffold and vertical slice

Everything happens in dependency order, and the goal is the slice. Build profile: every provider set to `mock` except Supabase, with `NEXT_PUBLIC_DEMO_MODE=true` (dev mode).

**Pass when all of these are true:**

- [ ] Person 1's browser session sends "@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later." Within 20 s, and without a reload, Person 2's session shows the plan card.
- [ ] That run went through a real model (`LLM_PROVIDER=meta`, or `google`), then `plan_day`, the FastAPI `/v1/plan` stub, and `apply_plan`. The run has exactly one `tool_calls` row with `succeeded`, and `agent_runs.status = succeeded`.
- [ ] The same prompt with `LLM_PROVIDER=mock` produces the same card, and `agent_runs.replayed = true`.
- [ ] `GET https://<vercel-url>/api/health` returns `{ web: ok, db: ok, optimizer: ok }`.
- [x] All 5 tool input modules and all 9 card modules exist in `@agp/shared`. `registry.ts` lists 5 tools, and `cards.tsx` maps 9 card types.

**If it fails:** nobody starts Milestone 2. Everyone swarms the broken step of the slice. CI (CO-106, Should) is worth landing before Milestone 2, because four people share `main`.

**Order.** Each step is about 30 minutes. Arrows mark the hand-offs the slice waits on.

| Step | FE | AI | CO | VO |
| --- | --- | --- | --- | --- |
| 1 | FE-101 verify versions, then create the app | AI-101 FastAPI skeleton | CO-101 write migration 2 | VO-101 repo and workspace → |
| 2 | FE-101 (cont.) → | AI-102 shared package → | CO-102 write migration 3 | VO-102 migration 1 → pushed first |
| 3 | FE-102 dependencies and test config → | AI-103 web skeleton → | push 2 and 3 → types; CO-103 | VO-103 env loader |
| 4 | FE-103 tokens, layout, providers | AI-104 LLM provider | push 4; CO-105 `withPolicy` | VO-104 Supabase clients → |
| 5 | FE-104 card frame and card map | AI-105 context and handles | CO-104 `apply_plan` → | VO-105 seed → |
| 6 | FE-105 `/api/messages` | AI-106 runner | CO-106 CI and lint rules (Should) | VO-106 sign-in |
| 7 | FE-106 chat view | AI-107 `plan_day` slice | help AI-107 | VO-107 deploy and health |
| 8 | FE-107 Realtime | slice in two sessions | slice in two sessions | slice in two sessions |

### M1 · VO

#### VO-101 · Repo, workspace, and Supabase link · Must

- **Files:** `package.json`, `pnpm-workspace.yaml`, `supabase/config.toml`
- **Depends on:** nothing
- **Produces:** the root scripts in [checklist](checklist.md) B2 (`dev`, `lint`, `typecheck`, `test`, `db:types`, `api:types`), and a linked Supabase project. `seed:demo` and `reset:demo` arrive with VO-105 and VO-216.
- **Done when:**
  - [x] Checklist B2 and the first half of B7 are done. `git log --oneline` shows `chore: add workspace config, license, and ignore rules` as the first commit, and `git check-ignore AGENTS.md skills planning/adr` prints all three paths.
  - [ ] Check: `node -v` prints 24 or later, `pnpm -v` prints 11.x, and `pnpm exec supabase projects list` shows the linked project.
- **Status:** not done. Reset 2026-09-25: no hosted Supabase project is linked (local stack only, design §11.4 item 1), so the `supabase projects list` check fails.
- **Commit:** `chore: init pnpm workspace and link supabase`

#### VO-102 · Migration 1 (foundation) and the database test harness · Must

- **Files:** `supabase/migrations/20260925200100_foundation.sql`, `web/tests/db/helpers.ts`, `web/tests/db/foundation.test.ts`
- **Depends on:** VO-101. The tests need FE-102's Vitest config.
- **Produces:** the design §3.3 file 1 tables and functions. `helpers.ts` exports `testBatch()` (returns `test:<uuid>`), `adminClient()`, `createUser({ batch, displayName? })` (returns `{ userId, email, client }`, signed in through a generated magic link; ADR 0016), `createTrip(batch, { members })` (returns `{ tripId, memberIds }`), and `cleanup(batch)`.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/foundation.test.ts` passes:
    - `handle_new_user creates a profile from display_name metadata, and "Guest" when there is none`
    - `is_trip_member is true for a joined member and false for a placeholder row`
    - `a signed-in non-member selects no trips and no trip_members`
    - `trip_members rejects status joined with a null profile_id`
    - `a trip can't have two organizers`
  - [ ] The migration is pushed first, before files 2–4, and `pnpm db:types` is committed with it.
- **Status:** not done. Reset 2026-09-25: the migration was never pushed to a hosted project (only applied to a local stack); the foundation tests passed there on 2026-09-23. 2026-09-26: re-run on a fresh local stack (`supabase db reset`, every migration through the pivot cleanup): `pnpm --filter web test:db` → 7 files, 31 passed. Still not pushed to a hosted project.
- **Commit:** `feat(db): foundation tables, membership helpers, and db test harness`

#### VO-103 · Env loader and env examples · Must

- **Files:** `web/src/lib/env/server.ts`, `web/src/lib/env/client.ts`, `web/src/lib/env/env.test.ts`, `web/.env.example`, `optimizer/.env.example`
- **Depends on:** FE-102
- **Produces:** `serverEnv` and `clientEnv`, typed and Zod-validated. They cover every variable in design §9.1 and §9.2, so later tasks never edit these files.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/env/env.test.ts` passes:
    - `fails boot with a list of every missing required variable`
    - `LLM_PROVIDER defaults to meta and needs META_MODEL_API_KEY; google needs its key and explicit model IDs`
    - `each Meta capability has its own flag, mock by default, and needs META_MODEL_API_KEY only when real`
    - `model IDs come from env, with the verified Meta defaults`
    - `rejects a live Stripe key (sk_live_)`
    - `accepts the build profile: every provider mock and no provider keys`
  - [ ] Check: `web/.env.example` contains no phone number.
- **Status:** done (2026-09-23; re-verified 2026-09-25 after the Meta switch: 8 passed, RED first on the five changed tests). Proof: `pnpm --filter web test src/lib/env/env.test.ts` → 6 passed (RED first: "Cannot find module ./client"); `grep -oE "\+1[0-9]{10}" web/.env.example` → only +15555550100; typecheck and lint exit 0. Re-verified 2026-09-26 after the journey pivot: the voice, segmentation, image, grounding, and vision-model variables are gone, and dev mode needs only `DEMO_ADMIN_TOKEN`. `pnpm --filter web test src/lib/env` → 9 passed (RED first: every case failed while the loader still required `VOICE_PROVIDER`).
- **Commit:** `feat(env): validated server and client env with examples`

#### VO-104 · Supabase clients and session proxy · Must

- **Files:** `web/src/lib/supabase/{browser.ts,server.ts,admin.ts,index.ts,session-guard.tsx}`, `web/src/lib/supabase/admin.test.ts`, `web/src/proxy.ts`
- **Depends on:** VO-103
- **Produces:** `getBrowserClient()`, `getServerClient()` (the user session, from cookies), and `getAdminClient()` (server only, secret key). Also `SessionGuard`, a pass-through stub that FE-103 mounts and VO-215 implements.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/supabase/admin.test.ts` passes: `getAdminClient throws a named error when SUPABASE_SECRET_KEY is missing`.
  - [ ] Check: `admin.ts` starts with `import 'server-only'`. A signed-in session survives a page reload (verified in VO-106).
- **Status:** not done. Reset 2026-09-25: the session-survives-reload check was never run, because VO-106 (sign-in) doesn't exist yet; the admin test and the `server-only` check pass.
- **Commit:** `feat(supabase): browser, server, and admin clients with session proxy`

#### VO-105 · Seed script with batches · Must

- **Files:** `package.json` (the root `seed:demo` script), `web/scripts/demo/seed.ts`, `web/scripts/demo/lib/{ids.ts,ids.test.ts,args.ts}`, `web/scripts/demo/fixtures/users.ts`, `web/scripts/demo/fixtures/saturday-trip.json` (the first version, from the venue list gathered before the event)
- **Depends on:** VO-102, CO-101 (pushed)
- **Produces:** `seed({ batch, stage? })` running design §10.4 steps 1, 3, 4, and 6. Step 4 sets dinner's area to Midtown (`area_label`, `area_lat`, `area_lng`). Step 3 also loads `fixtures/routes.json` when it exists (FE-305 writes it). Step 2 comes in CO-302, and step 5 in VO-201. `uuidFor(batch, name)` and `inviteTokenFor(batch)` come from `ids.ts`.
- **Done when:**
  - [x] `pnpm --filter web test -- scripts/demo/lib/ids.test.ts` passes:
    - `uuidFor is stable for the same batch and name, and differs across batches`
    - `inviteTokenFor returns 21 URL-safe characters, is stable per batch, and changes with DEMO_SEED_SECRET`
  - [ ] Check: running `pnpm seed:demo --batch dev-vo` twice prints identical row counts. The members are `Person 1` through `Person 4`, and Person 4 is a `placeholder` with an invite token. The script prints Person 4's invite link and the trip URL.
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test scripts/demo` → 9 passed (ids 4 from 2026-09-23; args and time RED first: missing modules); `pnpm --filter web test:db tests/db/seed.test.ts` → 5 passed (a mutation that dropped the members' insert-if-missing guard failed the re-run test). Check: `pnpm seed:demo --batch dev-vo` twice printed identical counts (profiles 3, trips 1, trip_members 4, member_constraints 4, itinerary_items 4, places 12), and printed the trip URL and Person 4's invite link.
- **Commit:** `feat(demo): idempotent seed with batches and a stable invite token`

#### VO-106 · Sign-in: magic link, plus the dev-mode picker · Must

- **Files:** `web/src/app/login/page.tsx`, `web/src/app/login/magic-link-form.tsx`, `web/src/app/login/magic-link-form.test.tsx`, `web/src/app/auth/confirm/route.ts`, `web/src/app/auth/confirm/route.test.ts`, `web/src/features/demo/components/demo-login-picker.tsx`, `web/src/features/demo/components/demo-login-picker.test.tsx`, `web/src/features/demo/server/demo-sign-in.ts`, `supabase/templates/magic-link.html`, `supabase/config.toml`
- **Depends on:** VO-104, VO-105, AI-103
- **Produces:** the magic-link form, which is how members sign in ([ADR 0016](adr/0016-magic-link-auth.md)), and `/auth/confirm`, which verifies the link's `token_hash` with the server client and redirects to a same-origin `next`. The local magic-link email template links to `/auth/confirm` with `{{ .TokenHash }}`. In dev mode only, `DemoLoginPicker` and the server action `demoSignIn(email)` sign in as a seeded user through `auth.admin.generateLink`; no passwords exist.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/app/login src/app/auth src/features/demo/components` passes:
    - `the form sends a magic link with emailRedirectTo /auth/confirm?next=/trips, then shows "Check your email"` (Supabase client mocked)
    - `Send shows pending while sending, and an error when Supabase rejects the email`
    - `/auth/confirm verifies token_hash and redirects to next; a bad or used link goes to /login?error=link`
    - `/auth/confirm ignores a next that isn't a same-origin path` (no open redirect)
    - `the picker renders only in dev mode, listing Person 1, Person 2, and Person 3 as buttons at least 44 px tall`
    - `demoSignIn rejects when NEXT_PUBLIC_DEMO_MODE is not true`
  - [ ] Check: one browser signs in through a magic link (Mailpit locally, the inbox on a hosted project), another as Person 2 through the picker, and both stay signed in after a reload. This also closes VO-104's check.
- **Status:** backend done; UI is FE scope (2026-09-26). Proof: `pnpm --filter web test src/app/auth src/features/demo` → 6 passed (RED first: no confirm route or `demo-sign-in` module); a mutant without the same-origin check failed the open-redirect test. `demoSignIn` lives in `features/demo/server/demo-sign-in.ts` (its test beside it, not under `components`) and accepts only `DEMO_EMAIL_DOMAIN` addresses, because `generateLink` creates a user for an unknown email. Until `/login` exists, a failed link lands on `/?error=link` (`FAILED_LINK` in the route), so `src/app/routes.test.ts` has no dead link; the login page switches it to `/login?error=link`. Open: the login page, magic-link form, picker, and the reload check (browser).
- **Commit:** `feat(auth): magic-link sign-in and a dev-mode picker for seeded users`

#### VO-107 · Deploy the web app, plus the health route · Must

- **Files:** `web/src/app/api/health/route.ts`, `web/src/app/api/health/route.test.ts`, `optimizer/Dockerfile`, `optimizer/.dockerignore`
- **Depends on:** VO-103, AI-101
- **Produces:** `GET /api/health` returning `{ web, db, optimizer }`. Also the Vercel project (web), with every web env var set (checklist B9). The optimizer stays on localhost for all testing; its Vultr deploy is VO-S02 (Should, last). The Dockerfile is built but not pushed here. It's Must because the Stripe webhooks and the Milestone 3 switches need a public web URL.
- **Done when:**
  - [x] `pnpm --filter web test -- src/app/api/health/route.test.ts` passes:
    - `returns 200 with optimizer "error" when FastAPI is unreachable`
    - `returns all "ok" when the db and optimizer respond`
  - [ ] Check: `docker build ./optimizer` succeeds, and `curl http://localhost:3000/api/health` (optimizer on `localhost:8000`) returns all `ok`.
- **Status:** backend done; deploy blocked (2026-09-26). Proof: `pnpm --filter web test src/app/api/health/route.test.ts` → 3 passed (RED first: no route module). Check: `docker build` of the optimizer succeeded from a copy of the Dockerfile that only trusts this sandbox's egress-proxy CA (the committed Dockerfile is unchanged; the sandbox's build container can't verify PyPI without it); with that container on :8000 and `next dev`, `curl /api/health` → `{"web":"ok","db":"ok","optimizer":"ok"}`, and with it stopped → `optimizer:"error"`, still 200. **Blocked:** the Vercel project needs an account (checklist B9).
- **Commit:** `chore(deploy): vercel web with a health route`

#### VO-108 · Database test target · Should

- **Files:** `web/src/test/{db-target.ts,db-target.test.ts}`, `web/vitest.config.ts`, `web/tests/db/helpers.ts`, `CONTRIBUTING.md`
- **Depends on:** VO-102
- **Produces:** `DB_TEST_TARGET`. `local` (the default) runs the `db` and `stripe` projects against `supabase start` with `web/.env.local`. `dev` overlays the three Supabase keys from a gitignored `web/.env.test.local`, which points at a separate hosted project, for machines without Docker. Both projects also collect `tests/payments/**`, where the CO-209, CO-210, and CO-212 suites live.
- **Done when:**
  - [x] `pnpm --filter web test -- src/test/db-target.test.ts` passes:
    - `defaults to the local stack and uses web/.env.local as is`
    - `rejects an unknown target`
    - `dev overlays the three Supabase keys from .env.test.local on the local env`
    - `dev without .env.test.local names the file`
    - `dev names every missing key, and never prints a value`
    - `dev refuses a project that web/.env.local also points at`
  - [ ] Check: with a dev project's keys in `web/.env.test.local` and the migrations pushed there, `DB_TEST_TARGET=dev pnpm --filter web test:db` passes.
- **Status:** in progress (2026-09-25). The unit tests pass (RED first: "Cannot find module ./db-target"). Without the file, `DB_TEST_TARGET=dev` stops with the named error; the default target still runs against the local stack. A probe file under `tests/payments/` was listed by both the `db` and `stripe` projects. The Check needs a dev project's keys.
- **Commit:** `feat(test): DB_TEST_TARGET for a hosted dev project`

### M1 · FE

#### FE-101 · Verify versions and create the Next.js app · Must

- **Files:** `web/**` (generated), `web/public/maplibre/*`, `web/src/components/ui/*` (generated by shadcn), `planning/stack.md`
- **Depends on:** VO-101 (run the B1 check while you wait)
- **Done when:**
  - [ ] Checklist B1 prints `ok` or `200` for every package. Any replaced version is updated in `planning/stack.md`, with the verification date and a note in ADR 0001.
  - [ ] Checklist B3 is done. `pnpm --filter web build` passes, and `web/public/maplibre/` contains the worker files.
- **Status:** done (2026-09-23). Proof: B1 loop → every npm line `ok`, every PyPI line `200`; `pnpm --filter web build` → "Compiled successfully", exit 0.
- **Commit:** `chore(web): create next app with shadcn and mapcn`

#### FE-102 · Runtime dependencies and test config · Must

- **Files:** `web/package.json`, `pnpm-lock.yaml`, `web/vitest.config.ts`, `web/playwright.config.ts`, `web/src/test/server-only-stub.ts`
- **Depends on:** FE-101
- **Produces:** web scripts `test` (Vitest `unit` project), `test:db` (Vitest `db` project), `test:stripe` (Vitest `stripe` project: `PAYMENTS_PROVIDER=real` with a Stripe test key and the dev Supabase project; never run in CI), `e2e`, `typecheck`, and `lint`. The unit project aliases `server-only` to the empty stub.
- **Done when:**
  - [ ] Checklist B4 is done. `pnpm --filter web test` and `pnpm --filter web typecheck` pass with no tests yet.
  - [ ] Check: `grep '"\^' web/package.json` prints nothing, so every version is exact.
- **Status:** done (2026-09-23). Proof: `pnpm --filter web test` → exit 0 (no tests yet, `passWithNoTests`); `pnpm --filter web typecheck` → exit 0; `pnpm --filter web lint` → exit 0; `grep '"\^' web/package.json` → no output (exit 1). Chromium installed for Playwright.
- **Commit:** `chore(web): pin runtime and test dependencies`

#### FE-103 · Design tokens, root layout, and providers · Must

- **Files:** `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/app/providers.tsx`, `web/src/app/providers.test.tsx`, `web/src/app/page.tsx`
- **Depends on:** FE-102, VO-104
- **Produces:** the design §8.2 tokens as CSS variables with `@theme`, light and dark. `Providers` wraps `QueryClientProvider`, the Supabase browser client, and VO's `SessionGuard`. `/` is a static landing page that links nowhere; FE-202 turns it into the `/trips` or `/login` redirect once both routes exist.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/app/providers.test.tsx` passes: `query defaults are staleTime 30 s, retry 2, and refetchOnWindowFocus true`.
  - [ ] Check: the viewport meta includes `interactive-widget=resizes-content`, and toggling the OS dark mode switches the tokens.
- **Status:** done (2026-09-25, re-verified). The 2026-09-23 proof cited a slice run that never happened, and `/` redirected to routes that didn't exist. Now `/` is a static page, `src/app/routes.test.ts` fails on any internal path with no page or route (RED first: `/trips` and `/login`), and Playwright against `next start` read `interactive-widget=resizes-content` in the viewport meta and `--bg` switching from `#f6f5f1` (light) to `#121412` (dark).
- **Commit:** `feat(ui): design tokens, root layout, and providers`

#### FE-104 · Card frame, error card, and card map · Must

- **Files:** `web/src/components/card-frame/{card-frame.tsx,card-frame.test.tsx,error-card.tsx}`, `web/src/lib/tools/cards.tsx`, `web/src/lib/tools/cards.test.tsx`
- **Depends on:** FE-103, AI-103
- **Produces:** `CardFrame` (props per design §8.4), `ErrorCard`, and `renderCard(message)`. `renderCard` validates `card_payload` with the `CardPayload` union and falls back to the `unavailable` state when validation fails.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/components/card-frame src/lib/tools/cards.test.tsx` passes:
    - `renders an article labelled by its title`
    - `action buttons show a spinner and aria-busy while pending, and keep their label`
    - `the unavailable state reads "This card is out of date."`
    - `renderCard resolves a renderer for all 9 card types`
    - `a payload that fails its schema renders the unavailable state`
- **Status:** done (2026-09-23). Proof: `pnpm --filter web test src/components/card-frame src/lib/tools/cards.test.tsx` → 2 files, 7 passed (RED first: "Failed to resolve import ./card-frame" and "./cards"); typecheck and lint exit 0.
- **Commit:** `feat(chat): card frame, error card, and card registry`

#### FE-105 · Send-message route and agent run start · Must

- **Files:** `web/src/app/api/messages/route.ts`, `web/src/app/api/messages/route.test.ts`, `web/src/features/chat/server/send-message.ts`, `web/tests/db/send-message.test.ts`, `packages/shared/src/api/messages.ts`
- **Depends on:** FE-102, VO-104, CO-102, AI-103
- **Produces:** `sendMessage({ tripId, clientId, body, itemId? })`, which returns `{ messageId, agentRunId }`. A message whose body contains `@agent` (case-insensitive, as a whole word) inserts one queued `agent_runs` row through the admin client, and the route starts it with `after(() => startAgentRun(agentRunId))`. `maxDuration = 300`.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/send-message.test.ts` passes:
    - `the same client_id twice returns the same message_id and one row`
    - `a body with @agent creates exactly one queued agent_run linked by trigger_message_id`
    - `a non-member gets not_permitted`
  - [x] `pnpm --filter web test -- src/app/api/messages/route.test.ts` passes: `a body over 2000 characters returns 400 with { error: { code, message, retryable } }`.
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test:db tests/db/send-message.test.ts` → 6 passed (RED first: `sendMessage` was a stub, and the insert policy accepted another trip's item); `pnpm --filter web test src/app/api/messages src/features/chat` → 7 passed (RED first: no route). Migration `20260926071157_messages_same_trip_links.sql` makes the members' insert policy require `item_id` and `reply_to_message_id` on the message's own trip.
- **Commit:** `feat(chat): idempotent send-message route that starts agent runs`

#### FE-106 · Trip route and chat view · Must

- **Files:** `web/src/app/trip/[slug]/layout.tsx`, `web/src/app/trip/[slug]/page.tsx`, `web/src/features/chat/components/{chat-view.tsx,message-list.tsx,message-item.tsx,composer.tsx,chat-view.test.tsx}`, `web/src/features/chat/hooks/use-messages.ts`
- **Depends on:** FE-104, FE-105
- **Produces:** `ChatView` and `useMessages(tripId)` (query key `['messages', tripId]`).
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/chat/components/chat-view.test.tsx` passes:
    - `renders text bubbles and cards in created order`
    - `the composer sends with a fresh client_id and disables Send while pending` (review focus 1)
    - `an empty trip shows "Say hi, or type @agent to start planning."`
    - `three loading skeletons show while messages load`
- **Commit:** `feat(chat): trip chat view with composer`

#### FE-107 · Trip Realtime provider · Must

- **Files:** `web/src/lib/realtime/{trip-realtime-provider.tsx,invalidation-map.ts,invalidation-map.test.ts,coalesce.ts,coalesce.test.ts,index.ts}`, `web/src/app/trip/[slug]/layout.tsx`
- **Depends on:** FE-106
- **Produces:** `TripRealtimeProvider`, which opens channel `trip:{trip_id}` with the user's JWT and invalidates the design §6 keys. `invalidationFor(table)` returns the query keys to refetch.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/realtime` passes:
    - `maps every published table to the design §6 query keys`
    - `coalesces invalidations of the same key within 150 ms into one`
    - `a demo.reset broadcast clears the query cache and reloads the page`
  - [ ] Check: a message sent in one member's session appears in another's within 2 s, with no reload.
- **Commit:** `feat(realtime): trip channel with coalesced query invalidation`

#### FE-108 · Human-in-the-loop copy rule · Must

- **Files:** `packages/shared/src/copy/{human-in-loop.ts,human-in-loop.test.ts}`, `web/src/lib/copy/human-in-loop-copy.test.ts`
- **Depends on:** AI-102
- **Produces:** `HUMAN_IN_LOOP_LABEL` ("Agent proposed · You approve"), `MONEY_CARD_TYPES` (`plan`, `approval`, `booking_confirmed`, `price_change`), and `pairsAgentWithPaid(text, { speaker? })`. The web test scans every non-test file in `web/src`, `web/scripts/demo/fixtures`, and `packages/shared/src`.
- **Done when:**
  - [x] `pnpm --filter @agp/shared test -- src/copy` passes: the exact label, the money card types, five agent-as-payer phrasings flagged, first-person claims flagged only with `speaker: "agent"`, and six person-pays phrasings allowed.
  - [x] `pnpm --filter web test -- src/lib/copy` passes: `no copy, prompt, or fixture makes the agent the one who paid`, and a planted "Tickets paid by the agent" fails it.
- **Status:** done (2026-09-25). 16 shared tests and 2 web tests pass (RED first: "Cannot find module ./human-in-loop").
- **Commit:** `feat(shared): fee breakdown and human-in-the-loop copy rules`

### M1 · AI

#### AI-101 · FastAPI skeleton with the plan stub · Must

- **Files:** `optimizer/pyproject.toml`, `optimizer/requirements.txt`, `optimizer/requirements-dev.txt`, `optimizer/app/{__init__.py,main.py,models.py}`, `optimizer/tests/test_api.py`
- **Depends on:** VO-101
- **Produces:** the Pydantic `PlanRequest` and `PlanResponse` (design §2.2, with 1–5 slots and at most 3 unpinned), the bearer-token dependency, and `GET /health`. The stub `POST /v1/plan` puts everyone together at each slot's first candidate, with `engine = "enumeration"` and `status = "feasible"`.
- **Done when:**
  - [ ] `cd optimizer && pytest tests/test_api.py` passes:
    - `test_health_ok`
    - `test_plan_requires_bearer`: a missing or wrong token returns 401 with `{"error": {"code": "unauthorized"}}`
    - `test_plan_stub_returns_valid_response`: echoes `request_id`, and every slot has one group with every member
    - `test_rejects_four_unpinned_slots`: returns 422
    - `test_pinned_slot_must_have_one_candidate`: returns 422
  - [ ] Check: `uvicorn app.main:app --port 8000` serves `/openapi.json`, and `pnpm api:types` writes `packages/shared/src/optimizer/openapi.ts`.
- **Status:** done (2026-09-23). Proof: `cd optimizer && pytest tests/test_api.py` → 5 passed (RED first: collection error, no app.main); `ruff check` → "All checks passed!"; `uvicorn app.main:app --env-file .env --port 8000` serves /openapi.json; `pnpm api:types` → wrote packages/shared/src/optimizer/openapi.ts (456 lines).
- **Commit:** `feat(optimizer): fastapi skeleton with auth, models, and plan stub`

#### AI-102 · Shared contracts package · Must

- **Files:** `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `packages/shared/src/{index.ts,enums.ts,handles.ts,tool-result.ts,events.ts}`, `packages/shared/src/tools/{index.ts,search-places.ts,plan-day.ts,update-item.ts,summarize.ts,propose-purchase.ts}`, `packages/shared/src/cards/{index.ts,place-list.ts,plan.ts,itinerary-change.ts,summary.ts,approval.ts,booking-confirmed.ts,price-change.ts,member-joined.ts,error.ts}`, `packages/shared/src/api/index.ts`, tests next to each file
- **Depends on:** VO-101
- **Produces:**
  - Complete: every enum from design §3.1; the handle parsers `parseHandle` and `formatHandle`; `ToolResult` and `ToolErrorCode`; the `agent.status` and `demo.reset` event schemas; the `plan_day` input; and the `plan` and `error` card schemas.
  - Stubs with their final export names, each a `card_type` literal plus a loose object, for the other card and tool modules. Their owners fill them in (CO-201, VO-211, and the Should tasks).
  - `api/index.ts`, listing one module per route group as a stub: `messages`, `profile`, `itinerary`, `mandates`, `invites`, `demo`, `trips`, and `health`. Each route's owner fills its module.
  - `CardPayload`, a union discriminated on `card_type`.
- **Done when:**
  - [ ] `pnpm --filter @agp/shared test` passes:
    - `every enum lists exactly the values in design §3.1`
    - `parseHandle accepts M1, I12, O3, and P9, and rejects X1, M0, and I-1`
    - `plan_day rejects options_per_slot outside 2–3`
    - `the plan card requires applied_plan_rank = 1`
    - `CardPayload picks the schema by card_type`
- **Status:** done (2026-09-23). Proof: `pnpm --filter @agp/shared test` → 5 files, 8 tests passed (enums vs §3.1, parseHandle, options_per_slot 2–3, applied_plan_rank = 1, CardPayload discriminates); `pnpm --filter @agp/shared typecheck` → exit 0. RED first: all 5 files failed on missing modules. Re-verified 2026-09-26 after the journey pivot: 5 tool inputs, 9 card schemas, and the design §3.1 enums (no call, photo, or match enums). `pnpm --filter @agp/shared test` → 8 files, 32 passed (RED first: the enum test on 27 enums, and a new api-barrel test on the votes, voice-tools, recaps, and photos modules).
- **Commit:** `feat(shared): enums, handles, tool result, events, and contract barrels`

#### AI-103 · Web skeleton: entry points, tool folders, provider folders · Must

- **Files:** `web/src/features/{chat,itinerary,map,payments,booking,invite,profile,demo}/{index.ts,server.ts}`, `web/src/lib/tools/{registry.ts,registry.test.ts,define-tool.ts}`, `web/src/lib/tools/<each of the 5 tools>/{tool.ts,card.tsx}`, `web/src/lib/providers/{llm,payments,booking,places,routing}/{types.ts,index.ts}`, `web/src/lib/agent/index.ts`
- **Depends on:** FE-101, AI-102
- **Produces:**
  - Every export name in design §1's entry-point table, as a stub.
  - `defineTool({ name, input, description, handler })`, where the handler is `(input, ctx: RunContext) → Promise<ToolResult>`. `RunContext` is `{ tripId, runId, toolCallId, requesterMemberId, handles, admin }`.
  - `startAgentRun(runId)`, exported from `lib/agent/index.ts` as a stub.
  - Stub `card.tsx` files that render a plain `<article>` naming the card type. The M1 slice passes with the stub plan card.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/tools/registry.test.ts` passes: `registry lists exactly the 5 tool names from the tool_name enum`.
  - [ ] Check: `pnpm --filter web typecheck` passes with every stub in place.
- **Status:** done (2026-09-23). Proof: `pnpm --filter web test src/lib/tools` → registry test passed (RED first: "Cannot find module ./registry"); `pnpm --filter web typecheck` → exit 0 with every stub in place; lint exit 0. Re-verified 2026-09-26 after the journey pivot: the registry lists 5 tools, `cards.tsx` maps 9 card types, the gallery, recap, and voice features and the grounding, image, segmentation, and voice providers are gone, and `features/profile` exists. `pnpm --filter web test src/lib/tools` → 4 passed (RED first: 7 tools and 11 card types).
- **Commit:** `feat(web): feature entry points, tool folders, and provider interfaces`

#### AI-104 · LLM provider and recording keys · Must

- **Files:** `web/src/lib/providers/llm/{types.ts,real.ts,mock.ts,index.ts,mock.test.ts}`, `web/src/lib/agent/{recording-key.ts,recording-key.test.ts}`, `web/scripts/demo/fixtures/agent-recordings/plan-saturday-80-each-person-2s-vegetarian-person-4-joins-later.json` (hand-written: one `plan_day` step)
- **Depends on:** AI-103, VO-103
- **Produces:**
  - `getLlmProvider()`, picking `meta`, `google`, or `mock` from `LLM_PROVIDER`. `meta` is `@ai-sdk/openai-compatible` at `META_MODEL_API_BASE_URL` with `supportsStructuredOutputs: true` (ADR 0017).
  - `runAgent` per design §2.3: AI SDK 7 tool loop, 6 steps at most (a run still calling tools at the cap fails), 25 s and one retry per model call, 90 s per run.
  - `recordingKey(prompt | { trigger, slotKey })` and `recordingFileName(key)`.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/agent/recording-key.test.ts src/lib/providers/llm/mock.test.ts` passes:
    - `normalizes the plan prompt to "plan saturday 80 each person 2s vegetarian person 4 joins later"`
    - `mock runAgent returns the recorded steps in order and replayed = true`
    - `mock runAgent without a recording throws a named error`
    - `the meta provider never sends a tool_choice other than auto` (Meta returns 400 otherwise)
    - `meta generateObject sends response_format json_schema, not a forced tool call`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test -- src/lib/agent/recording-key.test.ts src/lib/providers/llm` → 17 passed (RED first: "Cannot find module ./mock", "./real", "./recording-key"). The two meta tests live in `real.test.ts`, and provider selection in `index.test.ts`. Each model request goes through `withPolicy` (25 s, one retry) by `wrapLanguageModel` middleware, so tools are never retried and never count against the 25 s; the run has a 90 s total. A tool that throws ends the run on every provider (`runAgent` rejects). After review: 21 tests in `src/lib/providers/llm` and `src/lib/agent`. The mock's `generateObject` throws `NotBuiltError` until a caller needs fixtures. Typecheck and lint exit 0. 2026-09-26: `describeImage` and the vision model left with the photo flow (journey pivot); 20 tests remain in those two folders.
- **Commit:** `feat(agent): llm provider with meta, google, and replay mock`

#### AI-105 · Agent context and handles · Must

- **Files:** `web/src/lib/agent/{context.ts,context.test.ts,handles.ts,handles.test.ts,prompt.ts}`
- **Depends on:** AI-102, CO-102 (types generated)
- **Produces:** `buildContext(tripId, requesterMemberId) → { system, messages, handles }`, and `resolveHandle(handles, 'I2') → uuid`. An unknown handle throws a `ToolError` with code `unknown_handle`.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/agent` passes:
    - `assigns M# by sort_order, I# by starts_at, and O# by rank, identically on repeated calls`
    - `renders members as "M1 Person 1 (organizer)" with budgets, and "M4 Person 4 (placeholder)"`
    - `includes the last 30 messages with sender names, and the requester's handle`
    - `resolveHandle on an unknown handle throws unknown_handle`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test src/lib/agent` → 14 passed in `handles.test.ts` and `context.test.ts` (RED first: "Cannot find module ./handles" and "./context"); `pnpm --filter web test:db tests/db/agent-context.test.ts` → 2 passed (`loadTripSnapshot` against the local stack). The rendering is pure (`renderContext` over a `TripSnapshot`); `buildContext(tripId, requesterMemberId, admin?)` loads and renders.
- **Commit:** `feat(agent): trip context with stable handles`

#### AI-106 · Agent runner · Must

- **Files:** `web/src/lib/agent/{runner.ts,run-tool.ts,broadcast.ts}`, `web/src/lib/agent/index.ts`, `web/tests/db/runner.test.ts`
- **Depends on:** AI-104, AI-105, CO-102, FE-108
- **Produces:**
  - `startAgentRun(runId)`: claims the run (`queued → running`, 120 s lease), runs the loop, and writes the final agent text message.
  - `runTool(ctx, toolName, input)`: returns a stored `succeeded` output without re-running the handler.
  - `agent.status` broadcasts. Any failure writes an `error` card and marks the run `failed`.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/runner.test.ts` passes (mock LLM):
    - `a queued run is claimed once; a second claim for the same trip returns null while it's running`
    - `a succeeded tool_calls row is returned without calling the handler again`
    - `a handler that throws writes one error card and marks the run failed`
    - `a successful run ends succeeded with exactly one agent text message`
    - `a final text that makes the agent the payer (pairsAgentWithPaid, speaker agent) is replaced with "I proposed it. Each of you approves your own share."` (HumanInLoopLabel)
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test:db tests/db/runner.test.ts` → 11 passed on the local stack (RED first: "Cannot find package @/lib/agent/runner"): the five listed, plus broadcasts in order, an unknown handle returned to the model, the recorded plan prompt replayed through the mock LLM, a missing recording ending in an error card, and `finish_agent_run` rejecting a non-member, finishing once, and refusing clients. The end of a run goes through a new write function, `finish_agent_run` (migration `20260926070135`; design §3.4). `runTool(ctx, tool, input)` takes the tool definition rather than its name.
- **Commit:** `feat(agent): runner with leases, idempotent tool calls, and status broadcasts`

#### AI-107 · Optimizer client and the `plan_day` slice · Must

- **Files:** `web/src/lib/optimizer/{client.ts,client.test.ts,build-plan-request.ts}`, `web/src/lib/tools/plan-day/tool.ts`, `web/tests/db/plan-day-slice.test.ts`
- **Depends on:** AI-101, AI-106, CO-104, CO-105
- **Produces:**
  - `getOptimizerClient().plan(request) → PlanResponse`: bearer token, `withPolicy` with an 8 s timeout and 1 retry.
  - A first `buildPlanRequest` (slots from items, candidates from `places` by category, no travel), which AI-208 replaces.
  - The `plan_day` handler, calling `applyPlan`.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/optimizer/client.test.ts` passes:
    - `sends the bearer token and parses the PlanResponse`
    - `a 5xx is retried once, then surfaces AppError provider_unavailable`
  - [x] `pnpm --filter web test:db -- tests/db/plan-day-slice.test.ts` passes: `plan_day moves the seeded items tbd → proposing → voting and writes one plan card`.
  - [ ] Check: the Milestone 1 criteria above pass.
- **Status:** done (2026-09-26), except the M1 criteria that need a real model key. Proof: `pnpm --filter web test src/lib/optimizer/client.test.ts` → 5 passed (RED first: "Cannot find module ./client"); `pnpm --filter web test:db tests/db/plan-day-slice.test.ts` → 1 passed (RED first: `createPlanDayTool` missing). A contract check sent a `buildPlanRequest` request to the real FastAPI stub on localhost, and the client parsed its answer. On a seeded trip, the recorded plan prompt ran through the mock LLM, the real `plan_day`, and the FastAPI stub: run `succeeded` with `replayed = true`, one `plan_day` call `succeeded`, one plan card and one agent text, morning/lunch/afternoon `voting`, dinner `tbd`. Per-person prices come from `places.raw.price_cents` (design §11.7).
- **Commit:** `feat(agent): plan_day end to end through the optimizer stub`

### M1 · CO

#### CO-101 · Migration 2 (places and itinerary) · Must

- **Files:** `supabase/migrations/20260925200200_places_itinerary.sql`, `web/tests/db/itinerary-schema.test.ts`
- **Depends on:** VO-102 (pushed first)
- **Produces:** design §3.3 file 2, with the `itinerary_items` transition trigger from design §4.1 and the `area_label`, `area_lat`, and `area_lng` columns for TBD blocks (§11.3, item 2).
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/itinerary-schema.test.ts` passes:
    - `an item can't go from tbd to voting without passing through proposing`
    - `area_label, area_lat, and area_lng are all set or all null`
    - `an item has at most one option per rank and per place`
    - `members select items; non-members select none`
    - `ends_at must be after starts_at`
  - [ ] Pushed right after file 1. `pnpm db:types` committed.
- **Status:** not done. Reset 2026-09-25: never pushed to a hosted project (only applied to a local stack); the schema tests passed there on 2026-09-23. 2026-09-26: re-run on a fresh local stack (`supabase db reset`, every migration through the pivot cleanup): `pnpm --filter web test:db` → 7 files, 31 passed. Still not pushed to a hosted project.
- **Commit:** `feat(db): places, routes, and itinerary tables`

#### CO-102 · Migration 3 (agent and chat) · Must

- **Files:** `supabase/migrations/20260925200300_agent_chat.sql`, `web/tests/db/agent-chat-schema.test.ts`
- **Depends on:** CO-101
- **Produces:** design §3.3 file 3, with the `agent_runs` transition trigger from design §4.5.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/agent-chat-schema.test.ts` passes:
    - `a user inserts only a text message as their own member`
    - `a second running run for the same trip violates the unique index`
    - `messages.client_id is unique`
    - `card_type is required exactly when kind = card`
  - [ ] Pushed. `pnpm db:types` committed.
- **Status:** not done. Reset 2026-09-25: never pushed to a hosted project (only applied to a local stack); the schema tests passed there on 2026-09-23. 2026-09-26: re-run on a fresh local stack (`supabase db reset`, every migration through the pivot cleanup): `pnpm --filter web test:db` → 7 files, 31 passed. Still not pushed to a hosted project.
- **Commit:** `feat(db): agent runs, messages, and tool calls`

#### CO-103 · Migration 4 (commerce, calls, and webhooks) · Must

- **Files:** `supabase/migrations/20260925200400_commerce.sql`, `web/tests/db/commerce-schema.test.ts`
- **Depends on:** CO-102
- **Produces:** design §3.3 file 4, with the mandate, share-row, and booking transition triggers from design §4.2–§4.3. `payment_holds` has one row per share and hold (`kind` is `own` or `fronted`), and a PaymentIntent ID may repeat across rows.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/commerce-schema.test.ts` passes:
    - `a share row can't go from captured back to authorized`
    - `an item has at most one live mandate`
    - `an authenticated user can't read webhook_events`
    - `a share has at most one own row and one fronted row`
  - [ ] Pushed. `pnpm db:types` committed.
- **Status:** not done. Reset 2026-09-25: never pushed to a hosted project (only applied to a local stack); the schema tests passed there on 2026-09-23. 2026-09-26: re-run on a fresh local stack (`supabase db reset`, every migration through the pivot cleanup): `pnpm --filter web test:db` → 7 files, 31 passed. Still not pushed to a hosted project.
- **Commit:** `feat(db): mandates, holds, bookings, and webhook events`

#### CO-104 · `apply_plan`, first version, and the function audit · Must

- **Files:** `supabase/migrations/<timestamp>_apply_plan.sql`, `supabase/migrations/<timestamp>_audit_definer_functions.sql`, `web/src/features/itinerary/server/apply-plan.ts`, `web/tests/db/apply-plan.test.ts`, `web/tests/db/function-hardening.test.ts`
- **Depends on:** CO-101, CO-102, CO-103
- **Produces:** `applyPlan({ tripId, actorMemberId, runId, toolCallId, mode, response, itemsBySlot, reasoning }) → { cardMessageId, changes }`, following the design §3.4 shape (membership check, pinned `search_path`). This version handles merged slots only; AI-209 adds splits, and AI-210 adds replans. The AI engineer owns this file from Milestone 2 on. The audit function lets one test cover every `security definer` function, including ones written later:

  ```sql
  create function public.audit_definer_functions()
  returns table (name text, search_path_pinned boolean, client_can_execute boolean)
  language sql stable security definer set search_path = '' as $$
    select p.proname::text,
           coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false),
           has_function_privilege('authenticated', p.oid, 'execute')
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef;
  $$;
  revoke execute on function public.audit_definer_functions() from public, anon, authenticated;
  ```

- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/apply-plan.test.ts` passes:
    - `writes options and attendees, moves items proposing → voting, inserts one plan card, and marks the tool call succeeded`
    - `calling it twice with the same tool_call_id writes nothing new`
    - `rejects a non-member actor with not_permitted and writes nothing`
    - `rejects a payload naming an item from another trip`
    - `the authenticated role can't execute apply_plan`
  - [ ] `pnpm --filter web test:db -- tests/db/function-hardening.test.ts` passes:
    - `every security definer function in public pins search_path`
    - `only claim_invite, create_trip, is_trip_member, and is_trip_organizer are executable by clients`

  The non-member test, which every later write function copies:

  ```ts
  it('rejects a non-member actor with not_permitted and writes nothing', async () => {
    const trip = await createTrip(batch, { members: ['Person 1', 'Person 2'] });
    const other = await createTrip(batch, { members: ['Person 9'] });
    const { error } = await adminClient().rpc('apply_plan', {
      payload: planPayload(trip, { actorMemberId: other.memberIds[0] }),
    });
    expect(error?.message).toMatch(/not_permitted/);
    expect(await countOptions(trip.tripId)).toBe(0);
  });
  ```

  `planPayload` and `countOptions` are small helpers in the same test file; `createTrip` and `adminClient` come from VO-102's `web/tests/db/helpers.ts`.
- **Status:** done (2026-09-23). Proof: `pnpm --filter web test:db tests/db/apply-plan.test.ts tests/db/function-hardening.test.ts` → 7 passed (RED first: 7 failed, function missing and applyPlan a stub); full `test:db` → 6 files, 28 passed; typecheck and lint exit 0. Migrations: 20260925200600_apply_plan.sql, 20260925200700_audit_definer_functions.sql. Verified on the local stack; not re-run since it went down (2026-09-25).
- **Commit:** `feat(db): apply_plan write function and definer-function audit`

#### CO-105 · `withPolicy` and `AppError` · Must

- **Files:** `web/src/lib/reliability/{with-policy.ts,with-policy.test.ts,app-error.ts,app-error.test.ts,index.ts}`
- **Depends on:** FE-102
- **Produces:** `withPolicy(fn, { timeoutMs, retries, backoffMs? })`, and `AppError` with `{ code, message, retryable, cause }`. `toToolError` and `toHttpError` map an `AppError` per design §2.4 and §7.3. The barrel also exports `recordWebhook` and `finishWebhook` as stubs for VO-203. The VO engineer owns `lib/reliability` from Milestone 2 on.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/reliability` passes (fake timers):
    - `times out after timeoutMs with code timeout, retryable true`
    - `retries 429, 5xx, and network errors with 400 ms × 2^n backoff`
    - `does not retry other 4xx errors`
    - `retries: 0 calls exactly once`
    - `toHttpError maps conflict to 409 and provider_unavailable to 502`
- **Status:** done (2026-09-23). Proof: `pnpm --filter web test src/lib/reliability` → 2 files, 7 passed with fake timers (RED first: "Cannot find module ./app-error"); typecheck and lint exit 0.
- **Commit:** `feat(reliability): withPolicy timeouts, retries, and AppError`

#### CO-106 · CI and import-boundary lint · Should

- **Files:** `.github/workflows/ci.yml`, `web/eslint.config.mjs`, `web/tests/lint/boundaries.test.ts`
- **Depends on:** FE-102, AI-101, AI-102
- **Produces:** the three CI jobs from checklist B11, and the `no-restricted-imports` rules from design §1. The VO engineer owns both files from Milestone 2 on.
- **Done when:**
  - [x] `pnpm --filter web test -- tests/lint/boundaries.test.ts` passes (ESLint Node API):
    - `app/ deep-importing features/payments/server/approve-hold is an error`
    - `app/ importing features/payments/server is allowed`
    - `lib/optimizer importing any feature is an error`
    - `a client component importing lib/providers is an error`
  - [ ] Check: a push to `main` runs all three jobs green.
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test tests/lint/boundaries.test.ts` → 6 passed (RED first: all four listed cases); the three jobs ran green on GitHub on PR #3 (web and shared, optimizer, contracts drift). A local ESLint rule stops a "use client" module from importing server-only code.
- **Commit:** `ci: lint, typecheck, tests, pytest, and contracts drift`

#### CO-107 · Fee breakdown function · Must

- **Files:** `packages/shared/src/money/{fees.ts,fees.test.ts}`, `packages/shared/src/index.ts`
- **Depends on:** AI-102
- **Produces:** `holdFees({ sharesCents, capPercent }) → { shareCents, processorFeeCents, platformFeeCents, totalCents, capCents }`, `shareCapCents(shareCents, capPercent)`, `frontedShareRefundCents({ ownSharesCents, frontedShareCents })`, and `FEE_SCHEDULE` (2.9% + 30¢, and a $0 platform fee). The only fee math in the repo (ADR 0019).
- **Done when:**
  - [x] `pnpm --filter @agp/shared test -- src/money` passes:
    - `a $42 share: processor fee $1.57, platform fee $0, total $43.57, cap $48 at 110%`
    - `itemizes the platform fee even when it's $0`
    - `a hold paying two shares (the organizer fronting Person 4) pays one fixed fee; its cap is the sum of the share caps`
    - `after the processor's fee, the platform always nets at least the shares` (every 7th cent up to $500)
    - `the cap covers the capped price plus its fees, and is never below the total`
    - `rejects fractional or negative cents, no shares, and a cap percent outside 100–125`
    - `refunds the fronted share plus the fee it added, so the organizer ends up paying what any member pays`
- **Status:** done (2026-09-25). 7 tests pass (RED first: "Cannot find module ./fees").
- **Commit:** `feat(shared): fee breakdown and human-in-the-loop copy rules`

---

## Milestone 2: each workstream's core feature, against mocks

Every provider is mocked; only Supabase and FastAPI (localhost until VO-S02) are real. Each engineer works in their own batch. Seed stages (VO-201 and the stage files, Should) let the collaborate, pay, and claim work start before the planner is finished, so they're worth doing early.

**Pass when all of these are true:**

- [ ] **Create profile:** a new member signs in, sets their name on `/profile`, and every member's chat and lanes show it without a reload.
- [ ] **AI-guided trip planner:** `pytest` is green, including parity and `test_seeded_replan`. With the mock LLM, the plan prompt produces a plan card with the `cp_sat` badge, 3 ranked plans, the split afternoon, and per-member score bars, with `solve_ms` under 2000. A second @agent message sent during a run waits in `queued`, then runs. The lanes show four lanes branching at the afternoon and merging at the dinner row. The map shows numbered stops, per-member routes, and the provisional "Dinner, TBD" pin with dashed legs, and the lanes and map show the same stops.
- [ ] **Invite and collaborate:** Person 4 joins from the invite link by magic link (a generated one in dev mode), and a second claim of the same link says it was already used. Members comment on lunch, the agent revises it, and every member's view updates; the organizer's lock marks the morning decided.
- [ ] **Group pay after confirmation:** on a trip whose morning is decided, the book prompt creates approval cards with the design §2.1 copy. Three approvals produce one booking and one capture per PaymentIntent. The CO-212 tests pass for all three Person 4 orders, and the payments concurrency suites pass on mocks.
- [ ] Every Must task's unit and database tests pass locally.

**If it fails:** anyone whose flows passed pairs with the failing workstream, and Should work waits. Milestone 3 switches start with the flows that passed.

### M2 · FE

#### FE-201 · Trip shell: header and bottom tabs · Must

- **Files:** `web/src/components/trip-shell/{trip-header.tsx,bottom-tabs.tsx,bottom-tabs.test.tsx}`, `web/src/app/trip/[slug]/layout.tsx`
- **Depends on:** FE-107
- **Produces:** `TripHeader` (title, date, and `AgentStatusBar` slot) and `BottomTabs` (Chat, Plan, Map, Mine). Each tab links to a page its own track creates: Plan in FE-206, Map in FE-210, and Mine in FE-404.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/components/trip-shell` passes:
    - `the current tab has aria-current="page"`
    - `the header shows the trip title and date in the trip's timezone`
  - [ ] Check: on a phone, the bottom tabs sit above the home indicator, and the composer stays above the keyboard.
- **Commit:** `feat(ui): trip shell with header and bottom tabs`

#### FE-202 · Trip list and root redirect · Must

- **Files:** `web/src/app/trips/page.tsx`, `web/src/app/trips/trip-list.tsx`, `web/src/app/trips/trip-list.test.tsx`, `web/src/app/page.tsx`
- **Depends on:** FE-103, VO-106
- **Done when:**
  - [ ] `pnpm --filter web test -- src/app/trips` passes:
    - `active trips come first, then past trips`
    - `each trip links to /trip/<slug>`
    - `no trips shows an empty state`
  - [ ] `/` redirects a signed-in user to `/trips` and anyone else to `/login`, and `src/app/routes.test.ts` still passes.
- **Commit:** `feat(ui): trip list with active and past trips`

#### FE-204 · Trip view model: interface and fixtures · Must

- **Files:** `web/src/lib/trip-view/{types.ts,check.ts,check.test.ts,use-trip-view.ts,index.ts}`, `web/src/lib/trip-view/fixtures/{voting.ts,booked.ts,no-area.ts}`
- **Depends on:** FE-102, AI-102
- **Produces:** the one shape that both the lanes and the map render (design §8.3), plus hand-checked fixtures and a consistency checker. After this task, three tracks run in parallel:
  - lanes: FE-206, FE-220
  - map: FE-210, FE-211
  - data: FE-218, which builds a `TripView` from database rows

  `useTripView(tripId)` is declared here and returns `{ status: 'loading' }` until FE-218 implements it. That way the plan and map pages can call it from the start.

  ```ts
  /** What the lanes and the map both render. Built from database rows by buildTripView (FE-218). */
  export interface TripView {
    members: LaneMember[];              // memberId, displayName, initials, laneToken
    slots: SlotView[];                  // time order; each slot has 1 group (merged) or 2 (split)
    stops: Record<string, StopView>;    // itemId → stop; the lanes and the map both read labels here
    legs: LegView[];                    // per member, between consecutive stops
    branches: BranchPoint[];            // { slotKey, groups: memberIds[][] } where lanes split
    merges: MergePoint[];               // { slotKey, itemId, memberIds } where split lanes rejoin
  }

  export type StopView =
    | { kind: 'place'; itemId: string; label: string; number: number; lat: number; lng: number }
    | { kind: 'provisional'; itemId: string; label: string; area: string; lat: number; lng: number };

  export interface LegView {
    memberId: string;
    fromItemId: string;
    toItemId: string;
    style: 'solid' | 'dashed';          // dashed exactly when the leg ends at a provisional stop
    mode: 'walking' | 'driving' | null; // null on a dashed leg
    minutes: number | null;             // null on a dashed leg
    geometry: LineString;               // a straight line on a dashed leg
  }
  ```

  `SlotView`, `GroupView`, and `OptionView` carry what the lanes need: items, statuses, attendees, options, and comment counts.

  | Fixture | What it pins, checked by hand |
  | --- | --- |
  | `voting.ts` | The seeded trip after planning. Morning and lunch are merged. The afternoon splits into Person 1 with Person 4, and Person 2 with Person 3. Dinner is a provisional "Dinner, TBD" stop in Midtown. There are 12 legs (3 per member), 4 of them dashed into the provisional stop; one branch (afternoon) and one merge (dinner). |
  | `booked.ts` | After the pay flow. The aquarium is booked, dinner is decided at a Midtown restaurant, and the afternoon runs 15:00–18:00. There are 12 legs, all solid. |
  | `no-area.ts` | Dinner is TBD with no area. There's no dinner stop, and each lane's last leg ends at the afternoon: 8 legs. |

- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/trip-view` passes:
    - `checkTripView finds no problems in any fixture`
    - `checkTripView flags a dashed leg that ends at a place stop, and a solid leg that ends at a provisional one`
    - `checkTripView flags a leg whose endpoint has no stop`
    - `the voting fixture has one provisional stop in Midtown, 4 dashed legs into it, 1 branch, and 1 merge`
    - `the booked fixture has no provisional stop and no dashed legs`
- **Commit:** `feat(trip-view): view model, consistency check, and hand-checked fixtures`

#### FE-206 · Lanes view · Must

- **Files:** `web/src/features/itinerary/components/{plan-view.tsx,lanes-view.tsx,slot-row.tsx,group-block.tsx,item-block.tsx,option-list.tsx,lanes-view.test.tsx}`, `web/src/app/trip/[slug]/plan/page.tsx`
- **Depends on:** FE-204
- **Produces:** `PlanView` and `LanesView`, per the design §8.3 hierarchy. They render a `TripView`, and the plan page gets one from `useTripView(tripId)`. Built and tested against FE-204's fixtures, so this track needs no real data.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/itinerary/components/lanes-view.test.tsx` passes:
    - `the voting fixture's afternoon renders two group blocks, each with its attendees' initials`
    - `the voting fixture's dinner row renders one merged block for all four members, reading "Dinner, TBD · Midtown", marked provisional`
    - `the booked fixture's dinner row shows the restaurant's name`
    - `every stop label in the lanes comes from view.stops`
    - `slot-row skeletons show while loading`
    - `a trip with no items shows "No plan yet. Ask @agent to plan the day."`
- **Commit:** `feat(itinerary): lanes view with split and merged slots`

#### FE-207 · Lane connectors · Should

- **Files:** `web/src/features/itinerary/components/lane-connectors.tsx`, `web/src/features/itinerary/lib/{compute-lane-edges.ts,compute-lane-edges.test.ts}`
- **Depends on:** FE-206
- **Produces:** `computeLaneEdges(view) → [{ memberId, fromItemId, toItemId, kind: 'straight' | 'branch' | 'merge', laneToken }]`, read from `TripView.branches` and `TripView.merges`, and tested against FE-204's fixtures.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/itinerary/lib/compute-lane-edges.test.ts` passes:
    - `four members split 2/2 in the afternoon give two branches out of lunch and two merges into dinner`
    - `each edge carries its member's lane token`
  - [ ] Check: the SVG lines use lane colors, and every lane still shows initials.
- **Commit:** `feat(itinerary): lane connectors that branch and merge`

#### FE-208 · Person filter and My plan · Must

- **Files:** `web/src/features/itinerary/components/{person-filter.tsx,person-filter.test.tsx}`
- **Depends on:** FE-206
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/itinerary/components/person-filter.test.tsx` passes:
    - `?member=me shows only the signed-in member's items`
    - `member chips are buttons with aria-pressed`
- **Commit:** `feat(itinerary): person filter and my plan`

#### FE-209 · Routing provider and route cache · Must

- **Files:** `web/src/lib/providers/routing/{real.ts,mock.ts,index.ts,real.test.ts,mock.test.ts}`, `web/src/lib/providers/routing/fixtures/ors-directions.json`, `web/src/features/map/server/ensure-routes.ts`, `web/tests/db/ensure-routes.test.ts`
- **Depends on:** CO-101, CO-105
- **Produces:** `getRoutingProvider()`, and `ensureRoutes(pairs) → Map<'from:to', { mode, durationS, distanceM, geometry }>`. AI-209 uses it.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/providers/routing` passes:
    - `mock walking uses 4.8 km/h and driving 25 km/h, with a straight line`
    - `real maps an ORS directions response to a GeoJSON LineString, a duration, and a distance`
  - [x] `pnpm --filter web test:db -- tests/db/ensure-routes.test.ts` passes:
    - `pairs under 1.5 km use walking`
    - `only missing pairs are fetched and upserted`
- **Status:** backend done (2026-09-26, AI worker). Proof: `pnpm --filter web test src/lib/providers/routing` → 6 passed and `pnpm --filter web test:db tests/db/ensure-routes.test.ts` → 3 passed (RED first: missing `./distance`, `./real`, and the mock). The ORS directions fixture is hand-built in the ORS v2 GeoJSON format, because `ORS_API_KEY` is empty; the real switch is FE-301. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(map): routing provider and cached ensureRoutes`

#### FE-210 · Map view with numbered stops · Must

- **Files:** `web/src/features/map/components/{map-view.tsx,trip-map.tsx,stop-marker.tsx,map-view.test.tsx}`, `web/src/features/map/lib/style.ts`, `web/src/app/trip/[slug]/map/page.tsx`
- **Depends on:** FE-204
- **Produces:** `MapView`, which renders a `TripView`'s stops, including the provisional pin. The map page gets the view from `useTripView(tripId)`. Built and tested against FE-204's fixtures. The tile style URL is the single constant in `style.ts` ([ADR 0011](adr/0011-carto-basemap-before-commercial-use.md)).
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/map/components/map-view.test.tsx` passes (MapLibre mocked):
    - `renders a numbered pin for every place stop in the voting fixture`
    - `renders the provisional "Dinner, TBD" pin in Midtown in the voting fixture, styled as provisional`
    - `renders the dinner pin at the decided restaurant in the booked fixture`
    - `every pin label comes from view.stops`
    - `with the map unavailable, it lists the stops instead`
  - [ ] Check: on a mobile browser, the CARTO and OpenStreetMap attribution is visible, and the worker loads from `/maplibre/`.
- **Commit:** `feat(map): trip map with numbered and provisional stops`

#### FE-211 · Per-member route lines · Must

- **Files:** `web/src/features/map/components/{route-line.tsx,travel-time-label.tsx,route-line.test.tsx}`
- **Depends on:** FE-204, FE-210
- **Produces:** route lines and travel-time labels drawn from `TripView.legs`. The legs, their geometry, and their style all come from the view model; this task computes none of them.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/map/components/route-line.test.tsx` passes:
    - `the voting fixture draws one line per leg (12), each in its member's lane color`
    - `the 4 legs into the provisional stop are dashed, and every other leg is solid`
    - `a solid leg's label shows whole minutes and says walk or drive, and a dashed leg has no label`
    - `the booked fixture draws 12 solid legs, converging on the decided dinner`
- **Commit:** `feat(map): per-member routes with travel times`

#### FE-212 · Shared stop selection · Should

- **Files:** `web/src/features/map/hooks/{use-selected-stop.ts,use-selected-stop.test.ts}`, `web/src/features/itinerary/components/item-block.tsx`, `web/src/features/map/components/stop-marker.tsx`
- **Depends on:** FE-206, FE-210
- **Produces:** `useSelectedStop()`, which reads and writes `?stop=<item_id>`.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/map/hooks` passes:
    - `selecting a stop sets ?stop=<item_id> with router.replace`
    - `the matching item block has aria-current="true"`
- **Commit:** `feat(map): shared stop selection between lanes and map`

#### FE-213 · Desktop split view · Should

- **Files:** `web/src/components/split-view.tsx`, `web/src/components/split-view.test.tsx`, `web/src/app/trip/[slug]/layout.tsx`
- **Depends on:** FE-201, FE-206, FE-210
- **Done when:**
  - [ ] `pnpm --filter web test -- src/components/split-view.test.tsx` passes (`matchMedia` mocked):
    - `at 1280 px, chat, lanes, and map render side by side`
    - `below 1024 px, the bottom tabs render instead`
  - [ ] Check: on desktop, the columns are 380 px, flexible, and 40%.
- **Commit:** `feat(ui): desktop three-column layout`

#### FE-214 · Recovery: reconnect, foreground, and pull to refresh · Must

- **Files:** `web/src/lib/realtime/{use-trip-recovery.ts,use-trip-recovery.test.ts}`, `web/src/components/{reconnect-banner.tsx,pull-to-refresh.tsx}`
- **Depends on:** FE-107
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/realtime/use-trip-recovery.test.ts` passes (fake timers; review focus 3):
    - `SUBSCRIBED after CHANNEL_ERROR invalidates every trip key`
    - `becoming visible after more than 5 s hidden invalidates every trip key and resubscribes if needed`
    - `the online event invalidates every trip key`
    - `not SUBSCRIBED for 3 s polls messages and itinerary every 5 s and shows "Reconnecting…"`
    - `pulling past the threshold invalidates every trip key`
- **Commit:** `feat(realtime): recovery on reconnect, foreground, and pull to refresh`

#### FE-215 · Agent status bar · Should

- **Files:** `web/src/features/chat/components/{agent-status-bar.tsx,agent-status-bar.test.tsx}`
- **Depends on:** FE-201
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/chat/components/agent-status-bar.test.tsx` passes:
    - `shows the latest agent.status label in an aria-live="polite" region`
    - `clears 1.5 s after done or failed`
- **Commit:** `feat(chat): live agent status bar`

#### FE-216 · Error card retry · Should

- **Files:** `web/src/components/card-frame/error-card.tsx`, `web/src/features/chat/hooks/{use-retry-message.ts,use-retry-message.test.ts}`
- **Depends on:** FE-104, FE-105
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/chat/hooks/use-retry-message.test.ts` passes:
    - `Try again re-sends the triggering message body with a new client_id`
    - `no Try again button when retryable is false`
- **Commit:** `feat(chat): retry from error cards`

#### FE-218 · Trip view from itinerary rows · Must

- **Files:** `web/src/lib/trip-view/{build-trip-view.ts,build-trip-view.test.ts,fetch-trip-rows.ts,use-trip-view.ts}`, `web/src/lib/trip-view/fixtures/rows/{voting.json,booked.json,no-area.json}`
- **Depends on:** FE-204, CO-101
- **Produces:** `buildTripView(rows) → TripView` and the real `useTripView(tripId)`. The hook uses query key `['itinerary', tripId]`, so the design §6 invalidation map refreshes it. The adapter computes each stop once (design §8.3), including the provisional case. It builds legs with street geometry from the routes cache for confirmed legs, and a dashed straight line into a provisional stop, with no routing call. It also computes the branches and merges. This replaces the Phase 2 `useItinerary` and `stopFor`. The rows fixtures are the database rows behind FE-204's view fixtures.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/trip-view/build-trip-view.test.ts` passes:
    - `buildTripView on each rows fixture equals the matching hand-checked view fixture, and checkTripView finds no problems`
    - `groups sibling items by slot_key in starts_at order, and hides superseded and cancelled items`
    - `counts comments per option`
    - `a voting item's stop is its rank-1 option's place; a decided or booked item's is its chosen place`
    - `a tbd item with an area gets a provisional "Dinner, TBD" stop, and one without an area gets none`
    - `legs into a provisional stop are dashed straight lines, and the routes cache isn't read for them`
    - `a confirmed leg with no cached route is a straight solid line with no travel time`
  - [ ] Check: after planning the seeded trip, the plan and map pages show the same stops, including the Midtown pin with four dashed legs. After dinner is decided and booked, both show the restaurant, with solid legs.
- **Commit:** `feat(trip-view): build the view model from itinerary rows`

#### FE-219 · The human-in-the-loop label on every money surface · Must

- **Files:** `web/src/components/human-in-loop-label.tsx`, `web/src/components/card-frame/{card-frame.tsx,card-frame.test.tsx}`, `web/src/lib/tools/{cards.tsx,cards.test.tsx}`, `web/src/features/itinerary/components/lanes-header.tsx`
- **Depends on:** FE-104, FE-108, FE-206
- **Produces:** `HumanInLoopLabel`, which `CardFrame` renders in the header of every `MONEY_CARD_TYPES` card, so card owners get it without code of their own. The lanes header shows it whenever a share amount is visible.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/components/card-frame src/lib/tools/cards.test.tsx` passes:
    - `renderCard shows "Agent proposed · You approve" on every MONEY_CARD_TYPES card, and on no other card type`
    - `the label is read before the amounts (it precedes them in the DOM)`
  - [ ] `pnpm --filter web test -- src/features/itinerary` passes: `the lanes header shows the label when a share amount is visible`.
- **Commit:** `feat(ui): human-in-the-loop label on money surfaces`

#### FE-220 · Item comments · Must

- **Files:** `web/src/features/itinerary/components/{item-comments.tsx,comment-thread.tsx,item-comments.test.tsx}`
- **Depends on:** FE-105, FE-206
- **Produces:** `CommentThread({ itemId })`, mounted under each item. A comment is sent through `sendMessage` with `item_id`, so it lands as a member message and "@agent" in one starts a revision run.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/itinerary/components/item-comments.test.tsx` passes:
    - `a comment posts with the item's id and shows under that item`
    - `a second tap while posting sends no second request` (review focus 1)
    - `a comment with @agent starts one agent run`
- **Commit:** `feat(itinerary): comments on items`

#### FE-221 · Profile page · Must

- **Files:** `web/src/app/profile/{page.tsx,profile-form.tsx,profile-form.test.tsx}`
- **Depends on:** FE-103, VO-220
- **Produces:** `/profile` with the member's display name and avatar, saved through `PATCH /api/profile`.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/app/profile/profile-form.test.tsx` passes:
    - `shows the current name, saves with pending, and keeps the values on error`
    - `a name over 80 characters is rejected before sending`
  - [ ] Check: a new member sets their name, and every member's chat and lanes show it without a reload.
- **Commit:** `feat(profile): profile page with name and avatar`

#### FE-222 · `discussed` stage and e2e 02-collaborate · Should

- **Files:** `web/scripts/demo/stages/discussed.ts`, `web/e2e/02-collaborate.spec.ts`
- **Depends on:** FE-220, AI-216, VO-201, VO-217
- **Produces:** `discussed.apply({ admin, batch, tripId })`: Person 2 comments on lunch, and a revision run answers with an `itinerary_change` card.
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/02-collaborate.spec.ts` passes: `Person 2 comments on lunch, all three browsers show it under the item within 2 s, and "@agent make lunch cheaper" produces a revision card`.
  - [ ] Check: `pnpm seed:demo --batch dev-fe --stage discussed` leaves one comment and one revision card on lunch.
- **Commit:** `test(e2e): collaborate flow and discussed seed stage`

### M2 · AI

#### AI-201 · Optimizer test double and fixture plan · Must

- **Files:** `web/src/lib/optimizer/{mock.ts,mock.test.ts}`, `web/scripts/demo/fixtures/mock-plan.json` (hand-written from the design §10.2 target plan)
- **Depends on:** AI-107
- **Produces:** `mockPlan(request) → PlanResponse` with `engine = "mock"`. It's a test double that tests inject into the optimizer client; the product never switches to it at runtime. It returns the fixture plan for the seeded trip's shape; for anything else, everyone goes together to each slot's first candidate. The database tests of `plan_day` and re-planning use it.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/optimizer/mock.test.ts` passes:
    - `returns the fixture plan for the seeded trip, with engine mock`
    - `returns everyone together at the first candidate for any other request`
- **Status:** done (2026-09-26, AI worker). Proof: `pnpm --filter web test src/lib/optimizer/mock.test.ts` → 2 passed (RED first: no `./mock`). `mock-plan.json` uses the seeded demo batch's member IDs and `uuidFor('demo','place:<key>')`; its scores are illustrative. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `test(optimizer): optimizer test double with the seeded fixture plan`

#### AI-202 · Scoring interface and planner fixtures · Must

- **Files:** `optimizer/app/score_table.py`, `optimizer/tests/test_score_table.py`, `optimizer/tests/fixtures/{small_request.json,small_table.json,small_expected.json}`
- **Depends on:** AI-101
- **Produces:** the contract between scoring and the engines (design §2.2), plus fixtures small enough to check by hand: 4 members, 2 slots, 2–3 candidates. Once this lands, AI-203 (scoring), AI-204 (enumeration), AI-205 (CP-SAT), and AI-207 (the request builder) can proceed in parallel, even with different people on them. Engines read only a `ScoreTable`, never the request, and never compute a score themselves:

  ```python
  @dataclass(frozen=True)
  class ScoreTable:
      """Everything an engine needs. Built by scoring.build_score_table (AI-203)."""
      members: list[str]                               # member IDs, in request order
      slots: list[SlotInfo]                            # key, together, pinned place and members, candidate IDs
      utility: dict[tuple[int, int, int], float]       # (member, slot, candidate) → w_p·preference − w_c·cost
      allowed: dict[tuple[int, int, int], bool]        # dietary needs and opening hours, from rules.py
      travel: dict[tuple[int, int, int], float]        # (slot, previous candidate, candidate) → travel, 0..1
      arrival_ok: dict[tuple[int, int, int], bool]     # same keys: arrives within 15 min of the slot start
      price: dict[tuple[int, int], int]                # (slot, candidate) → cents per person
      budget: list[int | None]                         # per member; None means unlimited
      weights: Weights
      infeasible_reasons: list[str]                    # found while building; names members as {member:<uuid>}


  def plan_score(table: ScoreTable, assignment: Assignment) -> PlanScore:
      """The one objective both engines maximize: mean member score + w_f × min − split penalty."""
  ```

  `plan_score` is implemented here, because it is the objective. `build_score_table` is only declared here, and AI-203 implements it.
- **Done when:**
  - [x] `cd optimizer && pytest tests/test_score_table.py` passes:
    - `test_small_table_round_trips_from_json`
    - `test_plan_score_matches_the_hand_computed_values_in_small_expected`
    - `test_plan_score_adds_fairness_and_subtracts_the_split_penalty`
  - [ ] Check: `small_expected.json` lists the top 3 plans for `small_table.json`, worked out by hand in a comment block at the top of the test.
- **Status:** done (2026-09-26, parallel worktree). Proof: `cd optimizer && pytest tests/test_score_table.py` → 5 passed (RED first: "No module named app.score_table"). A brute-force script confirms the hand-computed top 3 (0.86925, 0.818375, 0.8165).
- **Commit:** `feat(optimizer): score table interface, objective, and planner fixtures`

#### AI-203 · Rules and scoring: build the score table · Must

- **Files:** `optimizer/app/rules.py`, `optimizer/app/scoring.py`, `optimizer/tests/test_rules.py`, `optimizer/tests/test_scoring.py`
- **Depends on:** AI-202
- **Produces:** `build_score_table(request) → ScoreTable`, using the hard-constraint predicates `dietary_ok`, `budget_ok`, `open_ok`, and `arrival_ok`, and the design §2.2 terms `preference`, `cost`, and `travel`.
- **Done when:**
  - [x] `cd optimizer && pytest tests/test_rules.py tests/test_scoring.py` passes:
    - `test_dietary_needs_tags_on_food_slots_only`
    - `test_null_budget_means_unlimited`
    - `test_open_through_start_plus_duration`
    - `test_arrival_allows_15_minutes_late`
    - `test_preference_formula`: interests {art, history, food}, tags {art}, rating 4.5 → 0.7 × 1/3 + 0.3 × 0.75 = 0.4583
    - `test_cost_is_zero_when_every_candidate_is_free`
    - `test_travel_caps_at_45_minutes`
    - `test_build_score_table_on_small_request_equals_small_table` (within 1e-6)
    - `test_infeasible_reason_names_the_member`: a vegetarian with no vegetarian lunch option
- **Status:** done (2026-09-26, parallel worktree). Proof: `cd optimizer && pytest tests/test_rules.py tests/test_scoring.py` → 11 passed (RED first: missing modules). `Slot` gained an optional `category` (design §11.7), so dietary rules know the food slots.
- **Commit:** `feat(optimizer): rules and scoring build the score table`

#### AI-204 · Enumeration engine · Must

- **Files:** `optimizer/app/plan_enumerate.py`, `optimizer/tests/test_enumerate.py`
- **Depends on:** AI-202
- **Produces:** `enumerate_plans(table, params) → EngineResult` with `engine = "enumeration"`. It reads only the `ScoreTable`, and passes the table's infeasible reasons through. They name members as `{member:<uuid>}` tokens, which `plan_day` replaces with display names.
- **Done when:**
  - [x] `cd optimizer && pytest tests/test_enumerate.py` passes:
    - `test_top3_sorted_by_plan_score`
    - `test_together_slot_has_one_group`
    - `test_groups_have_at_least_two_members_and_at_most_two_groups`
    - `test_pinned_slot_keeps_its_place_and_members`
    - `test_top_plan_on_small_table_equals_small_expected`
    - `test_too_large_beyond_limits`: 7 members, 4 unpinned slots, or 7 candidates → `too_large`
    - `test_no_plan_returns_infeasible_with_the_table_reasons`
- **Status:** done (2026-09-26, parallel worktree). Proof: `cd optimizer && pytest tests/test_enumerate.py` → 19 passed (RED first: missing module). An exact branch-and-bound search; it matched brute force on 158 random tables.
- **Commit:** `feat(optimizer): exhaustive enumeration engine`

#### AI-205 · CP-SAT engine · Must

- **Files:** `optimizer/app/plan_cpsat.py`, `optimizer/tests/test_cpsat.py`
- **Depends on:** AI-202
- **Produces:** `solve_plans(table, params) → EngineResult` with `engine = "cp_sat"`, the top 3 through no-good cuts, and a time limit of `time_limit_ms ÷ max_plans` per solve. It reads only the `ScoreTable`.
- **Done when:**
  - [x] `cd optimizer && pytest tests/test_cpsat.py` passes:
    - `test_top_plan_on_small_table_equals_small_expected`
    - `test_three_distinct_plans_via_nogood_cuts`
    - `test_fairness_term_raises_the_lowest_member`
    - `test_respects_the_time_limit`
- **Status:** done (2026-09-26, parallel worktree). Proof: `cd optimizer && pytest tests/test_cpsat.py` → 6 passed (RED first: missing module). It agreed with enumeration on 120 random tables.
- **Commit:** `feat(optimizer): cp-sat engine with top-3 plans`

#### AI-206 · Engine selection, parity, and fallback · Must

- **Files:** `optimizer/app/main.py`, `optimizer/tests/test_parity.py`, `optimizer/tests/test_fallback.py`
- **Depends on:** AI-203, AI-204, AI-205
- **Produces:** `/v1/plan`: it builds the `ScoreTable`, runs CP-SAT, falls back to enumeration per design §2.2, and turns the engine result into a PlanResponse.
- **Done when:**
  - [x] `cd optimizer && pytest tests/test_parity.py tests/test_fallback.py` passes:
    - `test_parity_top_plan_on_three_fixtures`
    - `test_engine_enumeration_param_forces_the_fallback`
    - `test_ortools_import_failure_falls_back` (monkeypatched)
    - `test_unknown_solver_status_falls_back`
- **Status:** done (2026-09-26, parallel worktree). Proof: `cd optimizer && pytest tests/test_parity.py tests/test_fallback.py` → 7 passed; whole optimizer 57 passed, ruff clean. The recorded plan prompt on a seeded trip ran through the real engines (cp_sat, 30 ms) and the run succeeded.
- **Commit:** `feat(optimizer): engine selection with enumeration fallback`

#### AI-207 · Plan request builder · Must

- **Files:** `web/src/lib/optimizer/{build-plan-request.ts,build-plan-request.test.ts,find-places.ts}`, `web/scripts/demo/fixtures/requests/{saturday-initial.json,saturday-replan.json}`
- **Depends on:** AI-107
- **Produces:**
  - `buildPlanRequest({ mode, members, constraints, items, places, travel }) → PlanRequest`: the earliest 3 open slots, plus pinned neighbors, plus the design §2.1 time shift. The shift is computed from the booked item's confirmed time; no code contains shifted times.
  - `findPlaces({ category, tags, limit })`: cache only; the provider fallback comes with AI-S04.
  - The two request fixtures, which pytest reads.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/optimizer/build-plan-request.test.ts` passes:
    - `default slots are the earliest 3 open items, so dinner is left out`
    - `a booked neighbor becomes a pinned slot with its place as the only candidate`
    - `a pinned item confirmed Δ later moves the unbooked slot right before it by Δ, and nothing else` (a synthetic trip, Δ = +30 min)
    - `candidates come from the places cache by category, at most 6 per slot`
    - `the committed request fixtures equal buildPlanRequest on saturday-trip.json`
- **Status:** done (2026-09-26, AI worker). Proof: `pnpm --filter web test src/lib/optimizer/build-plan-request.test.ts` → 5 passed (RED first: the AI-107 builder rejected the new input, and `timeShifts` didn't exist); a db test covers `travelMinutes` from the route cache or a straight-line estimate. Both committed request fixtures solve `optimal` on the local CP-SAT engine. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(optimizer): plan request builder with pinned context and time shift`

#### AI-208 · Seeded-trip plan test: invariants, not a pinned plan · Should

- **Files:** `optimizer/tests/test_seeded.py`, `web/scripts/demo/fixtures/mock-plan.json`
- **Depends on:** AI-206, AI-207
- **Done when:**
  - [ ] `cd optimizer && pytest tests/test_seeded.py` passes:
    - `test_seeded_trip_options`: on the seeded trip, the engine is `cp_sat`, `solve_ms` < 2000, it returns 2–3 distinct ranked options, and every option is feasible: each member's food slots meet their dietary rules, nobody visits a place twice, and every option fits each member's budget.
    - `test_mock_plan_matches_engine`: `mock-plan.json`'s assignments equal the engine's rank-1 plan.
- **Status:** re-scoped (2026-09-26). The old target pinned one exact plan (an afternoon split between the High Museum and Piedmont Park), and reaching it meant tuning weights for one fixture (design §11.7, item 6). Decision: the engine returns feasible ranked options, and Muse picks and explains one from the conversation and each person's remembered preferences (AI-217). Done: no member visits a place twice (`feat(optimizer): stop a member visiting a place twice in a day`; `pytest tests/test_repeats.py` → 14 passed, RED first: 11 failed). The old test on branch `test/seeded-optimizer` is superseded.
- **Commit:** `test(optimizer): check the seeded trip's options`

#### AI-209 · `plan_day`, full version · Must

- **Files:** `web/src/lib/tools/plan-day/{tool.ts,reasoning.ts,reasoning.test.ts}`, `supabase/migrations/<timestamp>_apply_plan_splits.sql`, `web/src/features/itinerary/server/apply-plan.ts`, `web/tests/db/plan-day.test.ts`
- **Depends on:** AI-201, AI-207, CO-104, FE-209
- **Produces:** the full design §2.1 handler. It saves `constraint_updates`, fills routes through `ensureRoutes`, writes server-side reasoning, and creates split siblings through `apply_plan`.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/tools/plan-day/reasoning.test.ts` passes: `names the best interest match, the price, and the travel minutes`.
  - [x] `pnpm --filter web test:db -- tests/db/plan-day.test.ts` passes:
    - `constraint_updates for "all" with budget_cents 8000 sets every member's budget`
    - `a split slot gets a sibling item with the same slot_key and each group's attendees`
    - `an unknown item handle returns unknown_handle and changes nothing`
    - `infeasible reasons show display names, not IDs`
    - `the ToolResult summary is at most 600 characters and mentions the split`
    - `apply_plan still rejects a non-member actor after the split changes`
- **Status:** done (2026-09-26, AI worker). Proof: `pnpm --filter web test src/lib/tools/plan-day/reasoning.test.ts` → 1 passed and `pnpm --filter web test:db tests/db/plan-day.test.ts` → 7 passed (RED first: no split sibling, `constraint_updates` written before a bad handle failed, no card on infeasible). Migration `20260926080526_apply_plan_splits.sql` replaces `apply_plan` to create split siblings and checks every slot before any write. The batch 2 review items are fixed: a response naming a non-candidate place is rejected with nothing written (no $0 fallback), and summaries show exact prices. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(agent): plan_day with constraints, splits, and reasoning`

#### AI-210 · Re-planning from comments · Must

- **Files:** `web/src/features/itinerary/server/{supersede-item.ts,apply-plan.ts}`, `supabase/migrations/<timestamp>_apply_plan_replan.sql`, `web/src/lib/agent/context.ts`, `web/tests/db/replan.test.ts`, `optimizer/tests/test_seeded_replan.py`, `web/scripts/demo/fixtures/saturday-trip.json` (hours, only if the seeded test needs it)
- **Depends on:** AI-206, AI-207, AI-209
- **Produces:** `supersedeItem(itemId) → { newItemId }`, and `apply_plan` in replan mode. The context includes the item's comments for revision runs.
- **Done when:**
  - [ ] `cd optimizer && pytest tests/test_seeded_replan.py` passes (§11.3, item 3). It reads `requests/saturday-replan.json`, which AI-207's builder generates from the seed fixture with dinner booked at 19:45:
    - `test_seeded_replan_shifts_the_afternoon`: the request's afternoon slot runs 15:00–18:00, and nothing earlier moves. The builder computed this; the test only asserts it.
    - `test_seeded_replan_respects_opening_hours`: every place in the rank-1 plan is open from its shifted start through start plus duration.
  - [ ] `pnpm --filter web test:db -- tests/db/replan.test.ts` passes:
    - `a replan applies the builder's shifted times to the afternoon items, records time_shift changes, and keeps their status`
    - `an option change on a decided item supersedes it, and the replacement goes tbd → proposing → voting and points back through supersedes_item_id`
    - `booked items never change`
    - `a revision run's context includes the item's comments and has a requester`
    - `apply_plan in replan mode rejects a non-member actor`
- **Commit:** `feat(agent): re-plan with superseding items and time shifts`

#### AI-211 · Plan card · Must

- **Files:** `web/src/lib/tools/plan-day/{card.tsx,card.test.tsx}`
- **Depends on:** AI-209, FE-218
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/tools/plan-day/card.test.tsx` passes:
    - `shows the engine badge and the solve time`
    - `member score bars show initials in lane colors, and the lowest member is labeled`
    - `each option shows its comment count from the itinerary query`
    - `replan mode lists each change as before → after`
    - `"See on map" links to /trip/<slug>/map?stop=<item_id>`
- **Commit:** `feat(agent): plan card with scores, comments, and changes`

#### AI-212 · Run queue · Must

- **Files:** `web/src/lib/agent/{queue.ts,runner.ts}`, `web/tests/db/run-queue.test.ts`
- **Depends on:** AI-106
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/run-queue.test.ts` passes:
    - `a run started while another is running stays queued, then runs when the first finishes`
    - `a running run with an expired lease is marked failed by the next claimant`
    - `a queued run older than 5 minutes is failed, not started`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test:db tests/db/run-queue.test.ts` → 4 passed (RED first: the queued run never started, the expired lease was never failed, and the stale run was started): the three listed plus "a live lease is left alone". Before claiming, the runner sweeps the trip (an expired lease or a queued run older than 5 minutes is failed with a timeout error card), and a finished run starts the oldest queued one in the same `after()`.
- **Commit:** `feat(agent): one running run per trip with a queue`

#### AI-213 · Agent run recorder · Should

- **Files:** `web/src/lib/agent/{recorder.ts,recorder.test.ts}`
- **Depends on:** AI-104, AI-106
- **Produces:** `AGENT_RECORD=1` support: a real run writes its recording for tests and offline development (design §7.5). Recordings are never a runtime fallback.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/agent/recorder.test.ts` passes:
    - `AGENT_RECORD=1 writes { key, steps, finalText } to the recording file`
    - `without AGENT_RECORD, nothing is written`
    - `a slow or failing model step ends in an error card; it never switches to a recording`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test src/lib/agent/recorder.test.ts` → 4 passed (RED first: no recorder module), including `never records a replay or a run without a key`. The runner wraps the provider with `withRecording(getLlmProvider(), { enabled: AGENT_RECORD })`; a missing recording in replay is a `RecordingNotFoundError` error card, never a fallback.
- **Commit:** `feat(agent): record real runs for tests`

#### AI-214 · `planned` stage, follow-up recording, and e2e 01-plan · Should

- **Files:** `web/scripts/demo/stages/planned.ts`, `web/tests/db/stage-planned.test.ts`, `web/e2e/01-plan.spec.ts`
- **Depends on:** AI-201, AI-210, AI-211, VO-201, VO-217
- **Produces:** `planned.apply({ admin, batch, tripId })`, which applies the fixture plan through `applyPlan`.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/stage-planned.test.ts` passes: `the planned stage leaves morning, lunch, and afternoon in voting, with the afternoon split, and dinner tbd with its area`.
  - [ ] `pnpm --filter web e2e -- e2e/01-plan.spec.ts` passes: `Person 1 sends the plan prompt, and Person 2's browser shows the status bar, then a plan card with 3 plans, a split afternoon, and score bars`.
- **Commit:** `test(e2e): plan flow and planned seed stage`

#### AI-216 · `update_item` tool and comment-driven revision · Must

- **Files:** `packages/shared/src/tools/update-item.ts`, `packages/shared/src/cards/itinerary-change.ts`, `supabase/migrations/<timestamp>_apply_item_change.sql`, `web/src/lib/tools/update-item/{tool.ts,card.tsx}`, `web/tests/db/update-item.test.ts`
- **Depends on:** AI-106, AI-210
- **Produces:** the design §2.1 handler, which is how comment threads turn into plan changes. The organizer locks options; the agent applies the group's explicit confirmations.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/update-item.test.ts` passes:
    - `swap_option by a non-organizer returns not_permitted with "discuss it in the comments"`
    - `swap_option by the organizer locks the item to decided`
    - `mark_tbd on a decided item supersedes it`
    - `add_slot with an area creates a TBD block with a provisional stop`
    - `every action on a booked item returns not_permitted`
    - `apply_item_change rejects a non-member actor with not_permitted`
- **Status:** done except `request_alternatives` (2026-09-26). Proof: `pnpm --filter web test:db tests/db/update-item.test.ts` → 6 passed (RED first: the stub returned not-built, and `apply_item_change` didn't exist); a mutant without the organizer check failed the non-organizer test. Migration `20260926081300_apply_item_change.sql` also keeps a purchase in progress from changing an item's option or attendees. `request_alternatives` returns a correctable error pointing at `plan_day` replan until AI-210's single-item path lands. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(agent): update_item tool`

### M2 · CO

#### CO-201 · Commerce contracts · Must

- **Files:** `packages/shared/src/tools/propose-purchase.ts`, `packages/shared/src/cards/{approval.ts,booking-confirmed.ts,price-change.ts}`, `packages/shared/src/api/mandates.ts`, tests next to each
- **Depends on:** AI-102
- **Done when:**
  - [x] `pnpm --filter @agp/shared test` passes:
    - `propose_purchase has no amount field and strips unknown keys`
    - `cap_percent must be 100–125`
    - `an approval share's cap_cents is at least its share_cents`
    - `each approval hold carries share, processor fee, platform fee, total, and cap cents, and the platform fee is present even at 0`
    - `booking_confirmed allows a null total for pay at venue`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter @agp/shared test` → 13 files, 41 passed (RED first: the stubs accepted anything; `ApprovalShare`, `ApprovalHold`, and the mandate route schemas were undefined).
- **Commit:** `feat(shared): commerce tool, card, and route schemas`

#### CO-202 · Money helpers · Must

- **Files:** `web/src/lib/money/{split.ts,cap.ts,format.ts,index.ts,money.test.ts}`
- **Depends on:** FE-102, CO-107
- **Produces:** `splitEvenly(totalCents, count, organizerIndex)`, `capFor(shareCents, percent)` (a thin wrapper over `shareCapCents` from `@agp/shared`, so caps include fees), and `formatUsd(cents)`.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/money` passes:
    - `splitEvenly(16800, 4) gives 4200 each`
    - `splitEvenly(10001, 3, 0) gives the organizer the extra cent`
    - `capFor(4200, 110) is 4800`
    - `formatUsd(9400) is "$94" and formatUsd(4250) is "$42.50"`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter web test src/lib/money` → 5 passed (RED first: "Cannot find module ./index").
- **Commit:** `feat(money): even split, caps, and formatting`

#### CO-203 · Payments provider mock · Must

- **Files:** `web/src/lib/providers/payments/{mock.ts,mock.test.ts,index.ts}`
- **Depends on:** AI-103, CO-105
- **Produces:** `getPaymentsProvider()`, per the design §2.3 interface.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/providers/payments/mock.test.ts` passes:
    - `authorize returns authorized with a pi_mock_ id`
    - `pm_mock_declined returns declined with a decline code`
    - `capturing more than the authorized amount throws`
    - `the same idempotency key returns the same result`
    - `refund returns one refund id per key`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter web test src/lib/providers/payments/mock.test.ts` → 7 passed (RED first: "Cannot find module ./mock"). IDs derive from the idempotency key, so every process agrees; `signMockWebhook` signs bodies in Stripe's format for CO-209.
- **Commit:** `feat(payments): deterministic payments mock`

#### CO-204 · Booking provider · Must

- **Files:** `web/src/lib/providers/booking/{mock-merchant.ts,index.ts,mock-merchant.test.ts}`
- **Depends on:** AI-103, CO-105
- **Produces:** `getBookingProvider("tickets")`: the mock merchant.
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/providers/booking` passes:
    - `a quote is price_cents × party size and expires in 15 minutes`
    - `book with the same idempotency key returns the same providerRef`
    - `simulatePriceChange changes only the next quote`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter web test src/lib/providers/booking` → 5 passed (RED first: "Cannot find module ./mock-merchant").
- **Commit:** `feat(booking): mock merchant`

#### CO-207 · `create_mandate` · Must

- **Files:** `supabase/migrations/<timestamp>_create_mandate.sql`, `web/src/features/payments/server/create-mandate.ts`, `web/tests/db/create-mandate.test.ts`
- **Depends on:** CO-103, CO-202, CO-204
- **Produces:** `createMandate({ ctx, itemId, optionId, capPercent?, note? }) → { mandateId, cardMessageId, shares }`. The actor is the run's requester.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/create-mandate.test.ts` passes:
    - `four attendees with Person 4 as a placeholder give own rows pending for Persons 1–3, Person 4's own row awaiting_member, and a fronted row for Person 4's share whose payer is Person 1`
    - `quote 16800, shares 4200, share caps 4800, total cap 19200, and Person 1's hold cap 9600`
    - `the card's holds come from holdFees: 4357 for each member's hold, 8682 for Person 1's with Person 4's share`
    - `rejects a non-member actor with not_permitted`
    - `the same idempotency key returns the same mandate`
    - `a second live mandate for the item is rejected`
    - `the approval card payload validates against the shared schema`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter web test:db tests/db/create-mandate.test.ts` → 10 passed (RED first: `NotBuiltError: createMandate`, then `PGRST202`). Migration `20260926072459_create_mandate.sql`; the seeded numbers hold: quote 16800, shares 4200, caps 4800, Person 1's hold 8682 (fee 282, cap 9600), each member's hold 4357 (fee 157). The card has one hold per possible payer, including each placeholder's own.
- **Commit:** `feat(payments): create_mandate with own and fronted share rows`

#### CO-208 · `propose_purchase` tool · Must

- **Files:** `web/src/lib/tools/propose-purchase/{tool.ts,tool.test.ts}`
- **Depends on:** CO-207, AI-106
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/tools/propose-purchase/tool.test.ts` passes:
    - `an item that isn't decided returns invalid_input telling the group to confirm it in comments first`
    - `an unknown handle returns unknown_handle`
    - `the idempotency key is mandate:{run_id}:{tool_call_id}`
    - `the summary gives each share and cap in dollars`
- **Status:** done (2026-09-26, commerce worker). Proof: `pnpm --filter web test src/lib/tools/propose-purchase/tool.test.ts` → 4 passed (RED first: no `createProposePurchaseTool`). Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(agent): propose_purchase tool`

#### CO-209 · Approve a hold · Must

- **Files:** `web/src/features/payments/server/{approve-hold.ts,handle-stripe-event.ts}`, `web/src/app/api/mandates/[id]/approve/route.ts`, `web/src/app/api/mandates/[id]/approve/route.test.ts`, `web/src/app/api/webhooks/stripe/route.ts`, `web/tests/db/approve-hold.test.ts`, `web/tests/payments/{kit.ts,approve-concurrency.test.ts}`
- **Depends on:** CO-203, CO-207, VO-203
- **Produces:**
  - `approveHold({ mandateId, memberId }) → { holds, satisfied }`. One PaymentIntent is authorized per payer, for the sum of the rows they may pay. CO-210 makes it call `finalizeMandate` once every share is satisfied, and CO-212 makes it call `settleFrontedShare` when the mandate is already captured.
  - `POST /api/webhooks/stripe` and `handleStripeEvent(event)`. It checks the signature against the raw body, records the event first (VO-203), then makes conditional share-row updates only (design §7.2). This task handles `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, and `payment_intent.canceled`.
  - `tests/payments/kit.ts`: one interface for every payments concurrency suite, over the mock provider now and Stripe test mode in CO-305. It creates payers, lists a PaymentIntent's events, and signs an event for delivery.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/approve-hold.test.ts` passes:
    - `a member's approval authorizes one PaymentIntent for their cap, with key pi-auth:{mandate_id}:{payer_member_id}`
    - `the organizer's approval authorizes one PaymentIntent up to 9600 and moves both their own and fronted rows to authorized`
    - `two concurrent approvals call authorize once` (review focus 1)
    - `a declined card moves the hold to declined and the mandate to partially_declined`
  - [x] `pnpm --filter web test -- src/app/api/mandates` passes: `403 for a non-member`.
  - [x] `pnpm --filter web test:db -- tests/payments/approve-concurrency.test.ts` passes, with mock payments now and Stripe test mode in CO-305:
    - `parallel approvals by the same member create one PaymentIntent and authorize it once`
    - `a duplicate amount_capturable_updated is recorded once and changes nothing`
    - `amount_capturable_updated handled before the synchronous response leaves the payer's rows authorized once`
    - `a webhook with a bad signature returns 400 and records nothing`
- **Status:** done on mock payments (2026-09-26, commerce worker); Stripe test mode is CO-305. Proof: `pnpm --filter web test src/app/api/mandates` → 3 passed; `pnpm --filter web test:db tests/db/approve-hold.test.ts tests/payments/approve-concurrency.test.ts` → 9 passed (RED first: no approve or webhook route, `approveHold` a stub). Migration `20260926074648_payment_holds_lease.sql` leases a share row during the provider call, so concurrent approvals authorize once. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed. Follow-up 2026-09-26, `fix(payments): release late holds only when no row pays a share`: a PaymentIntent that authorizes after the finalizer released the member's rows is now released and its ID recorded, and one whose own row already captured is never released for an excluded fronted row. `pnpm --filter web test src/features/payments/server/approve-hold.test.ts` → 2 passed (RED first: both failed without the fix).
- **Commit:** `feat(payments): approve holds, with the stripe webhook route`

#### CO-210 · Finalize a mandate · Must

- **Files:** `supabase/migrations/<timestamp>_complete_mandate.sql`, `web/src/features/payments/server/{finalize-mandate.ts,approve-hold.ts,handle-stripe-event.ts}`, `web/src/features/payments/lib/{plan-captures.ts,plan-captures.test.ts}`, `web/tests/db/finalize-mandate.test.ts`, `web/tests/payments/finalize-concurrency.test.ts`
- **Depends on:** CO-209
- **Produces:** `finalizeMandate(mandateId) → { status }`, using the design §4.2 precedence rule. `approveHold` calls it after the approval that satisfies the last share. Before calling Stripe, `finalizeMandate` writes each row's `pays_share` from `planCaptures`. The `payment_intent.succeeded` handler (added here) marks rows by that flag, so it and the synchronous path agree in either order. The rule lives in one pure function:

  ```ts
  /** Picks the one row that pays each share, and how much to capture on each PaymentIntent (design §4.2). */
  export function planCaptures(rows: ShareRow[]): CapturePlan {
    const paying = new Map<string, ShareRow>(); // share_member_id → the row that pays it
    for (const row of rows) {
      if (row.status !== 'authorized') continue;
      const current = paying.get(row.shareMemberId);
      // A share's own authorized hold always wins over the organizer's fronted row.
      if (!current || (row.kind === 'own' && current.kind === 'fronted')) paying.set(row.shareMemberId, row);
    }
    const captureByIntent = new Map<string, number>();
    for (const row of paying.values()) {
      captureByIntent.set(row.paymentIntentId, (captureByIntent.get(row.paymentIntentId) ?? 0) + row.shareCents);
    }
    const release = rows.filter((r) => r.status === 'authorized' && paying.get(r.shareMemberId) !== r);
    return { paying: [...paying.values()], captureByIntent, release };
  }
  ```

- **Done when:**
  - [x] `pnpm --filter web test -- src/features/payments/lib/plan-captures.test.ts` passes (review focus 5):
    - `Person 4's own row authorized: pi_person4 captures 4357, pi_person1 captures 4357, and the fronted row is released`
    - `Person 4's own row awaiting_member: pi_person1 captures 8682 for its own and fronted rows`
    - `every share has exactly one paying row`
  - [x] `pnpm --filter web test:db -- tests/db/finalize-mandate.test.ts` passes:
    - `two concurrent finalizers produce one booking and one capture per PaymentIntent` (review focus 1)
    - `each PaymentIntent is captured once, with amount_to_capture equal to holdFees' total for the rows it pays`
    - `a book() failure releases every hold and cancels the mandate with booking_failed`
    - `the item ends booked and pinned, with exactly one booking_confirmed card`
    - `complete_mandate rejects a non-member actor with not_permitted`
  - [x] `pnpm --filter web test:db -- tests/payments/finalize-concurrency.test.ts` passes, with mock payments now and Stripe test mode in CO-305 (review focus 1):
    - `approvals from all three members in parallel produce one booking and one capture per PaymentIntent`
    - `a duplicate payment_intent.succeeded changes nothing`
    - `payment_intent.succeeded handled before complete_mandate commits: rows end captured or released per pays_share, and the mandate is still booked once`
    - `a late amount_capturable_updated arriving after capture leaves the rows captured`
- **Status:** done on mock payments (2026-09-26, commerce worker); Stripe test mode is CO-305. Proof: `plan-captures.test.ts` → 4 passed; `finalize-mandate.test.ts` and `finalize-concurrency.test.ts` → 9 passed (RED first: no `plan-captures`, and the mandate never left `open`). Migration `20260926080050_complete_mandate.sql` adds `complete_mandate` (security definer, `search_path = ''`, clients can't execute it) and the finalizer's lease. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(payments): finalize mandates with one paying row per share`

#### CO-212 · Fronting and refund flow · Must

- **Files:** `web/src/features/payments/server/{on-placeholder-claimed.ts,settle-fronted-share.ts,approve-hold.ts,handle-stripe-event.ts}`, `web/tests/db/fronting.test.ts`, `web/tests/payments/fronting-concurrency.test.ts`
- **Depends on:** CO-210
- **Produces:** `onPlaceholderClaimed(memberId) → { pendingMandateIds }`, and `settleFrontedShare({ mandateId, memberId })`. `approveHold` calls `settleFrontedShare` when the mandate is already captured. Refunds carry `mandate_id` and `share_member_id` metadata. The `charge.refunded` handler (added here) marks that share's `fronted` row refunded, with the same conditional update as the synchronous path.
- **Done when**, covering design §11.1 item 3 and §11.3 item 4. Each order in the design §4.2 table is one test:
  - [x] `pnpm --filter web test:db -- tests/db/fronting.test.ts` passes (mock payments; review focus 5):
    - `claim before capture: Person 4's PaymentIntent captures 4357, Person 1's captures 4357 of 9600, the fronted row is released, and nothing is refunded`
    - `claim after capture: Person 1's PaymentIntent captured 8682; Person 4's approval captures 4357, then refunds Person 1 4325 (frontedShareRefundCents) once, with key cover-refund:{mandate_id}:{member_id}`
    - `never claims: Person 1's PaymentIntent captured 8682, Person 4's own row stays awaiting_member, and nothing is refunded`
    - `claims then declines after capture: the fronted row stays captured, and nothing is refunded`
    - `running the settlement twice refunds once`
    - `claiming moves only that member's awaiting_member rows to pending and returns their mandate ids`
  - [x] `pnpm --filter web test:db -- tests/payments/fronting-concurrency.test.ts` passes, with mock payments now and Stripe test mode in CO-305:
    - `Person 4 approving in parallel with the last finalizing approval: exactly one row pays Person 4's share, and nothing is refunded`
    - `two parallel settlements refund Person 1 once`
    - `a duplicate charge.refunded changes nothing`
    - `charge.refunded handled before the settlement's own update marks the fronted row refunded once`
- **Status:** done on mock payments (2026-09-26, commerce worker); Stripe test mode is CO-304. Proof: `fronting.test.ts` and `fronting-concurrency.test.ts` → 10 passed (RED first: `onPlaceholderClaimed` a stub, no `settleFrontedShare`); the race test forces all three interleavings of Person 4 approving during the last finalizing approval. Re-run after integration (`2e22e90`, clean `supabase db reset`): web unit 192 and db 29 files / 143 passed.
- **Commit:** `feat(payments): front a placeholder's share and refund the organizer once`

#### CO-213 · Share status badge · Must

- **Files:** `web/src/features/payments/components/{share-status-badge.tsx,share-status-badge.test.tsx}`, `web/src/features/payments/hooks/use-share-status.ts`
- **Depends on:** VO-214
- **Produces:** `useShareStatus(itemId, memberId) → { kind: 'fronted' | 'paid' | 'awaiting' | 'none', label }`, and `ShareStatusBadge({ itemId, memberId })`. FE-302 mounts it.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/payments/components/share-status-badge.test.tsx` passes:
    - `a captured fronted row with an uncaptured own row reads "Fronted by the organizer"`
    - `a captured own row reads "Paid"`
    - `a pending own row reads "Approve up to $48"`
    - `no mandate renders nothing`
    - `the badge states its status in text, not color alone`
- **Commit:** `feat(payments): share status badge for lanes`

#### CO-214 · `booked` stage and e2e 03-pay · Should

- **Files:** `web/scripts/demo/stages/booked.ts`, `web/scripts/demo/fixtures/agent-recordings/book-the-aquarium.json`, `web/e2e/03-pay.spec.ts`
- **Depends on:** CO-208, AI-214, VO-214, VO-217
- **Produces:** `booked.apply({ admin, batch, tripId })`: the aquarium goes through the mandate, three approvals, and finalizing on mock payments.
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/03-pay.spec.ts` passes: `the book prompt shows approval cards on three browsers with the design §2.1 copy, three approvals produce one booked card on all of them, and Person 4's row reads "Fronted by the organizer"`.
  - [ ] Check: `pnpm seed:demo --batch dev-co --stage booked` leaves the aquarium booked.
- **Commit:** `test(e2e): pay flow and booked seed stage`

### M2 · VO

#### VO-201 · Seed stages · Should

- **Files:** `web/scripts/demo/seed.ts`, `web/scripts/demo/lib/{args.ts,args.test.ts}`, `web/scripts/demo/stages/index.ts`, `web/scripts/demo/stages/{planned.ts,discussed.ts,booked.ts}` (stubs that throw "stage not implemented" until AI-214, FE-222, and CO-214 replace them)
- **Depends on:** VO-105
- **Produces:** `--stage planned|discussed|booked` (design §10.3). Do it early: stages let the other workstreams build their flows without waiting on each other.
- **Done when:**
  - [x] `pnpm --filter web test -- scripts/demo/lib/args.test.ts` passes:
    - `reads --batch and --stage, and the batch defaults to demo`
    - `runs stages in order up to the one requested`
    - `refuses --stage on the demo batch`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test scripts/demo/lib/args.test.ts` → the three listed pass (RED first: "Cannot find module ../stages"). The stage files throw "stage not implemented" naming AI-214, FE-222, and CO-214.
- **Commit:** `feat(demo): seed stages for isolated development`

#### VO-203 · Webhook recorder · Must

- **Files:** `web/src/lib/reliability/webhooks.ts`, `web/tests/db/webhooks.test.ts`
- **Depends on:** CO-103, CO-105
- **Produces:** `recordWebhook({ provider, eventId, type, payload }) → 'process' | 'skip'`, and `finishWebhook(provider, eventId, status, error?)`. Both are exported from the `lib/reliability` barrel that CO-105 created.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/webhooks.test.ts` passes:
    - `a first delivery returns process`
    - `a processed duplicate returns skip`
    - `a received event touched within 30 s returns skip`
    - `a received or failed event older than 30 s increments attempts and returns process`
- **Status:** done (2026-09-26, parallel worktree). Proof: `pnpm --filter web test:db tests/db/webhooks.test.ts` → 6 passed (RED first: `NotBuiltError: recordWebhook`), including concurrent deliveries processing an event once. No migration; conditional updates through supabase-js.
- **Commit:** `feat(reliability): record-first webhook handling`

#### VO-209 · Claim an invite · Must

- **Files:** `supabase/migrations/<timestamp>_claim_invite.sql`, `web/src/features/invite/server/{claim-invite.ts,preview-invite.ts}`, `web/src/app/api/invites/claim/route.ts`, `packages/shared/src/api/invites.ts`, `web/tests/db/claim-invite.test.ts`
- **Depends on:** VO-102, CO-101
- **Produces:** `claimInvite(token) → { tripSlug, memberId }`, and `previewInvite(token)`.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/claim-invite.test.ts` passes:
    - `a claim sets joined, profile_id, and claimed_at, clears the token, and returns the slug and member id`
    - `a second claim of the same token returns "already used"` (review focus 4)
    - `an unknown or empty token is rejected and changes nothing`
    - `a caller who's already a member gets an error`
    - `the trip's seed_batch is copied to the claimer's profile`
    - `previewInvite returns only the trip title, date, and that member's lane`
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test:db tests/db/claim-invite.test.ts` → 8 passed (the 6 above, a signed-out caller, and the seeded Person 4 link previewing and claiming once; RED first: `claimInvite isn't built yet`); `pnpm --filter web test src/app/api/invites` → 3 passed. A mutant without the row lock double-claimed in 1 of 3 runs of the concurrent-claim test. Migration `20260926075435_claim_invite.sql` adds `claim_invite` (security definer, `search_path = ''`, `authenticated` only) and `trip_members.claimed_token_hash`, so a used link reads "already used" rather than unknown.
- **Commit:** `feat(invite): claim_invite and preview`

#### VO-210 · Invite page · Must

- **Files:** `web/src/app/invite/[token]/page.tsx`, `web/src/features/invite/components/{invite-claim-view.tsx,lane-preview.tsx,join-button.tsx,invite-claim-view.test.tsx}`
- **Depends on:** VO-209, FE-103
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/invite/components` passes:
    - `signed out, Join asks for an email and sends a magic link back to this invite page`
    - `signed in, Join claims and goes to the trip`
    - `in dev mode, Join signs in a fresh claimer through a generated link, then claims`
    - `a second tap while joining does nothing` (review focus 1)
    - `a used invite reads "This invite was already used."` (review focus 4)
    - `an unknown token reads "Invite not found."`
    - `the invite URL is saved to localStorage`
- **Commit:** `feat(invite): invite page with magic-link join`

#### VO-211 · Member joined, and holds released to the joiner · Must

- **Files:** `web/src/features/invite/server/after-claim.ts`, `web/src/features/invite/components/{member-joined-card.tsx,member-joined-card.test.tsx}`, `packages/shared/src/cards/member-joined.ts`, `web/tests/db/after-claim.test.ts`
- **Depends on:** VO-209, CO-212
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/after-claim.test.ts` passes: `a claim calls onPlaceholderClaimed and writes one member_joined card listing the pending mandate ids`.
  - [ ] `pnpm --filter web test -- src/features/invite/components/member-joined-card.test.tsx` passes: `shows "Person 4 joined" with initials and lane color`.
- **Commit:** `feat(invite): member joined card and pending holds`

#### VO-213 · Booking confirmed card · Must

- **Files:** `web/src/features/booking/components/{booking-confirmed-card.tsx,booking-confirmed-card.test.tsx}`
- **Depends on:** CO-201, FE-104
- **Produces:** `BookingConfirmedCard`. Moved from CO: CO-206 became VO-213. The file sits in the booking feature, but VO owns it.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/booking/components` passes:
    - `shows the title, time, party size, and confirmation code`
    - `a null total reads "Pay at venue"`
- **Commit:** `feat(booking): booking confirmed card`

#### VO-214 · Approval card · Must

- **Files:** `web/src/lib/tools/propose-purchase/card.tsx`, `web/src/features/payments/components/{approval-card.tsx,approval-card.test.tsx}`, `web/src/features/payments/hooks/use-mandates.ts`, `web/src/features/payments/lib/{approval-copy.ts,approval-copy.test.ts}`
- **Depends on:** CO-202, CO-209, FE-104, CO-107, FE-219
- **Produces:** `ApprovalCard` and `useMandates(tripId)` (key `['mandates', tripId]`). Moved from CO: CO-211 became VO-214. The files sit in the payments feature and the `propose-purchase` tool folder, but VO owns them. CO-213's badge reads `useMandates`.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/payments` passes:
    - `a member's button reads "Approve up to $48"`
    - `Person 1's button reads "Approve up to $96, including Person 4's $48 until they join"`
    - `above the button, a member's card itemizes "Your share $42.00", "Processor fee $1.57", "Platform fee $0.00", "Total $43.57", and "Up to $48"; Person 1's also lists Person 4's $42.00 share, until they join, with a $2.82 fee and an $86.82 total` (TransparentFeeDisclosure)
    - `every amount comes from the card's holds; the card computes no fees`
    - `the card header reads "Agent proposed · You approve"` (HumanInLoopLabel)
    - `Person 4's row reads "Fronted by the organizer" until their own hold is captured, then "Paid"`
    - `the button shows pending with aria-busy, and is disabled after approval`
    - `a captured mandate shows "Booked"`
- **Commit:** `feat(payments): approval card with fronted-share copy`

#### VO-215 · Stale-session guard · Should

- **Files:** `web/src/lib/supabase/{session-guard.tsx,session-guard.test.tsx}`
- **Depends on:** VO-104, VO-210
- **Produces:** the real `SessionGuard`. FE-103 already mounts the pass-through stub from VO-104.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/supabase/session-guard.test.tsx` passes:
    - `an invalid-user or JWT error signs out and goes to the saved invite link`
    - `with no saved invite link, it goes to /login`
    - `a plain 403 doesn't sign out`
- **Commit:** `feat(auth): recover from stale sessions after a reset`

#### VO-216 · Reset script · Should

- **Files:** `package.json` (the root `reset:demo` script), `web/scripts/demo/reset.ts`, `web/scripts/demo/lib/{reset-plan.ts,reset-plan.test.ts}`
- **Depends on:** VO-201
- **Produces:** `reset({ batch, all })`, per design §10.5.
- **Done when:**
  - [x] `pnpm --filter web test -- scripts/demo/lib/reset-plan.test.ts` passes:
    - `deletes only the batch's trips and claimers, never seeded users or other batches`
    - `--all adds seeded users, places, routes, and storage objects`
  - [ ] Check: `pnpm reset:demo --batch dev-vo` finishes in under 30 s. An open browser on the trip reloads on `demo.reset`, and seeded users stay signed in.
- **Status:** done (2026-09-26), except the browser half of the Check. Proof: `pnpm --filter web test scripts/demo/lib/reset-plan.test.ts` → 3 passed (RED first: missing module); `pnpm --filter web test:db tests/db/reset.test.ts` → 1 passed (another batch untouched, the claimer removed, seeded users kept). `pnpm reset:demo --batch dev-vo` → 0.3 to 1.1 s. "An open browser reloads on demo.reset" needs FE-107. `--all` deletes the shared seed places, so it fails while another batch's options still point at them.
- **Commit:** `feat(demo): batch reset under 30 seconds`

#### VO-217 · e2e harness · Should

- **Files:** `web/playwright.config.ts`, `web/e2e/{global-setup.ts,global-teardown.ts,fixtures.ts,smoke.spec.ts}`
- **Depends on:** VO-201, VO-106, FE-106
- **Produces:** the fixtures `asPerson(1 | 2 | 3)` (a page signed in by visiting a generated magic link at `/auth/confirm`), `asPerson4()` (a signed-out page on the invite link), and `seededTrip({ stage })`. Each spec file gets its own `e2e-<random>` batch.
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/smoke.spec.ts` passes: `Person 1 signs in through a magic link, opens the seeded trip, and sees the chat; Person 2, in a second context, sees the same chat`.
- **Commit:** `test(e2e): harness with per-file batches and cast fixtures`

#### VO-219 · e2e 04-claim · Should

- **Files:** `web/e2e/04-claim.spec.ts`
- **Depends on:** VO-210, VO-211, CO-212, CO-214
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/04-claim.spec.ts` passes: `Person 4 opens the invite link, joins, sees their planned lane, and approves in one tap. Every browser shows the member_joined card and Person 4's row as "Paid", and an admin query finds exactly one refunded fronted row`.
- **Commit:** `test(e2e): placeholder claim flow`

#### VO-220 · Profile update route · Must

- **Files:** `web/src/app/api/profile/{route.ts,route.test.ts}`, `web/src/features/profile/server/update-profile.ts`, `packages/shared/src/api/profile.ts`, `web/tests/db/update-profile.test.ts`
- **Depends on:** VO-102
- **Produces:** `updateProfile({ displayName?, avatarUrl? }) → { profile }` with the user's session, and `PATCH /api/profile`. It updates the member's own profile row and copies the name onto their joined `trip_members` rows.
- **Done when:**
  - [x] `pnpm --filter web test:db -- tests/db/update-profile.test.ts` passes:
    - `sets the display name and copies it onto the member's joined rows`
    - `a caller with no session is rejected`
    - `one member's update changes no other member's rows`
  - [x] `pnpm --filter web test -- src/app/api/profile/route.test.ts` passes: `a name over 80 characters returns 400`.
- **Status:** done (2026-09-26). Proof: `pnpm --filter web test:db tests/db/update-profile.test.ts` → 4 passed and `pnpm --filter web test src/app/api/profile` → 3 passed (RED first: `updateProfile` was a stub, a session could write `stripe_customer_id`, and the route was missing). Migration `20260926080031_profile_update.sql` grants update on `display_name` and `avatar_url` only, with an own-row policy, and a definer trigger copies the name onto the user's joined `trip_members` rows.
- **Commit:** `feat(profile): profile update route`

---

## Milestone 3: integration on real providers

Providers switch from mock to real **one at a time**, on the deployed app. After each switch, run the affected flows by hand and keep the Must tests green. Each owner prepares the real adapter before their turn. Places stays mock; it's Should (AI-S04).

| Order | Switch | Owner | Flows to run after the switch | Done |
| --- | --- | --- | --- | --- |
| 1 | `LLM_PROVIDER=meta` (Muse Spark 1.3) | AI | plan, collaborate, pay | [ ] |
| 2 | `ROUTING_PROVIDER=real` (OpenRouteService) | FE | plan a day (map) | [ ] |
| 3 | `PAYMENTS_PROVIDER=real` (Stripe test mode) | CO | group pay, then placeholder claims | [ ] |

**Pass when all of these are true:**

- [ ] All three switches are ticked above.
- [ ] With all three real on the deployed app, starting from freshly seeded data:
  - The plan prompt produces a plan card from real Muse Spark within 20 s, with `cp_sat` from the optimizer (localhost, or Vultr once VO-S02 is done).
  - The map draws OpenRouteService street geometry to confirmed stops, and a dashed provisional leg to "Dinner, TBD".
  - The book prompt creates Stripe test-mode PaymentIntents with manual capture, one per payer: three, with Person 1's authorized up to $96. They're captured after the last approval, and their metadata includes `mandate_id`, `payer_member_id`, and `trip_id`.
  - Person 4 claims and approves. Stripe shows one capture on Person 4's PaymentIntent and one partial refund on Person 1's.
- [ ] The payments concurrency and webhook suites pass on Stripe test mode (CO-305).

**If it fails:** the failing provider stays mock until it's fixed. Nothing falls back to a mock at runtime.

### M3 · AI

#### AI-301 · Switch the agent to Meta's Model API · Must

- **Files:** `web/src/lib/agent/{prompt.ts,prompt.test.ts}`
- **Depends on:** AI-212
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/agent/prompt.test.ts` passes:
    - `the system prompt lists the 5 tools, says to use handles only, and forbids stating charged amounts`
    - `it includes the trip date, the requester's handle, and the TBD dinner`
  - [ ] Check: on the deployed app with `LLM_PROVIDER=meta`, each of the three prompts (plan, collaborate, and book) calls the expected tool with valid handles in 5 of 5 tries. Note the median first-step latency and the chosen `AGENT_MODEL` in your `AGENTS.md`.
- **Status:** prompt done; real-model check blocked (2026-09-26). Proof: `pnpm --filter web test src/lib/agent/prompt.test.ts` → 2 passed (RED first: no per-tool guidance in the prompt). `TOOL_GUIDE` is keyed by `ToolName`, so a new tool without guidance fails the type check. **Blocked:** the 5-of-5 check on the deployed app needs `META_MODEL_API_KEY` and a deploy.
- **Commit:** `feat(agent): tune the system prompt for muse spark`

#### AI-302 · Plan a day on real providers · Must

- **Files:** none
- **Depends on:** AI-301, VO-107
- **Done when:**
  - [ ] Check: from freshly seeded data on the deployed app, the plan card reaches every member within 20 s with `cp_sat` and `solve_ms` under 2000, and the lanes branch at the afternoon.

#### AI-303 · Comment-driven re-plan on real Muse Spark · Must

- **Files:** `web/src/lib/agent/prompt.ts` (only if the check fails)
- **Depends on:** AI-301, AI-216
- **Done when:**
  - [ ] Check: "@agent make lunch cheaper" (real Muse Spark) calls `update_item` or `plan_day` in replan mode, and the revision card shows the cheaper lunch.
- **Commit (if the prompt changed):** `fix(agent): comment-driven re-plan prompt`

#### AI-304 · Model failure check · Should

- **Files:** none
- **Depends on:** AI-301
- **Done when:**
  - [ ] Check: with an invalid `META_MODEL_API_KEY`, the plan prompt ends in an error card with Try again, and the run is `failed`. With `LLM_PROVIDER=google` and a Gemini `AGENT_MODEL`, the same prompt succeeds.

### M3 · FE

#### FE-301 · Switch routing to OpenRouteService · Must

- **Files:** FE-owned files only, where a bug turns up
- **Depends on:** FE-209, FE-218
- **Done when:**
  - [ ] Check: with `ROUTING_PROVIDER=real`, the map shows street geometry for confirmed legs. With a bad `ORS_API_KEY`, confirmed legs fall back to straight lines with no travel time, and no error is shown.

#### FE-302 · Share badge in the lanes · Must

- **Files:** `web/src/features/itinerary/components/{item-block.tsx,item-block.test.tsx}`
- **Depends on:** CO-213, FE-206
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/itinerary/components/item-block.test.tsx` passes:
    - `a booked item shows each member's ShareStatusBadge in their lane`
    - `an unbooked item shows no badge`
  - [ ] Check: after booking, Person 4's lane reads "Fronted by the organizer". After Person 4 claims and pays, it reads "Paid".
- **Commit:** `feat(itinerary): share status in each lane`

#### FE-303 · Lanes and map on real providers · Must

- **Files:** FE-owned files only, where a bug turns up
- **Depends on:** FE-206, FE-211, FE-301, AI-302
- **Done when:**
  - [ ] Check: with real providers, the lanes and the map show the same stops. "Dinner, TBD" stays dashed in both until dinner is decided; booked stops converge solid.

#### FE-304 · Realtime on a mobile network · Should

- **Files:** FE-owned files only, where a bug turns up
- **Depends on:** FE-214
- **Done when:**
  - [ ] Check: on phones on a mobile network, lock one for 10 s during planning, and it catches up on unlock. Airplane mode for 10 s shows the banner, then catches up. Pull to refresh works.

#### FE-305 · Routes fixture for seeding · Should

- **Files:** `web/scripts/demo/cache-routes.ts`, `web/scripts/demo/lib/{route-pairs.ts,route-pairs.test.ts}`, `web/scripts/demo/fixtures/routes.json`
- **Depends on:** FE-301, AI-208
- **Produces:** `routes.json`, geometry for every consecutive stop pair in the top 3 plans in both modes, so seeding makes no routing calls. `seed.ts` loads it (VO-105).
- **Done when:**
  - [ ] `pnpm --filter web test -- scripts/demo/lib/route-pairs.test.ts` passes: `lists every consecutive stop pair in the top 3 plans, in walking and driving mode`.
- **Commit:** `chore(demo): cached routes fixture for seeding`

### M3 · CO

#### CO-301 · Stripe provider · Must

- **Files:** `web/src/lib/providers/payments/{real.ts,real.test.ts}`
- **Depends on:** CO-203
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/providers/payments/real.test.ts` passes (Stripe SDK mocked):
    - `authorize creates one PaymentIntent with capture_method manual, confirm true, payment_method_types [card], the mandate and payer metadata, and Idempotency-Key pi-auth:{mandate_id}:{payer_member_id}`
    - `capture sends amount_to_capture, which may be less than the authorized amount`
    - `refund sends a partial amount with the idempotency key it's given, and mandate_id and share_member_id metadata`
    - `a card_declined error returns declined with the decline code`
    - `the client pins the API version and uses maxNetworkRetries 2 and a 10 s timeout`
    - `parseWebhook verifies the signature against the raw body`
- **Status:** done (2026-09-26, commerce worker; integrated by the lead). Proof: `pnpm --filter web test src/lib/providers/payments` → 2 files, 16 passed, covering all six cases plus test-card attachment only in demo mode and refusal of a live key. The pinned `STRIPE_API_VERSION` (`2026-08-26.dahlia`) equals the installed SDK's `ApiVersion`. `PAYMENTS_PROVIDER=real` now needs both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Not checked against Stripe itself: `web/.env.local` has no Stripe test key (CO-302, CO-303, and CO-305 need one).
- **Commit:** `feat(payments): stripe test-mode provider`

#### CO-302 · Seeded Stripe customers and claimer cards · Must

- **Files:** `web/scripts/demo/stripe-customers.ts`, `web/src/features/payments/server/{ensure-payer.ts,approve-hold.ts}`, `web/tests/db/ensure-payer.test.ts`
- **Depends on:** CO-301, VO-105
- **Produces:** `ensurePayer(memberId) → { customerId, paymentMethodId }`, which `approveHold` now uses to get the payer. `seed.ts` step 2 calls `stripe-customers.ts`.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/ensure-payer.test.ts` passes:
    - `reuses a stored customer and payment method`
    - `in dev mode, a claimer without one gets a customer and pm_card_visa`
    - `outside dev mode, a member without a payment method gets not_permitted`
  - [ ] Check: `pnpm seed:demo` with `PAYMENTS_PROVIDER=real` creates 3 customers the first time and none on a second run.
- **Commit:** `feat(payments): seeded customers and one-tap cards for claimers`

#### CO-303 · Switch payments to Stripe · Must

- **Files:** none
- **Depends on:** CO-301, CO-302
- **Done when:**
  - [ ] Check: on the deployed app, the booking flow leaves 3 PaymentIntents (Persons 1–3; Person 1's up to $96) in `requires_capture` after the approvals, then captured for $43.57, $43.57, and $86.82. Each carries `mandate_id`, `payer_member_id`, and `trip_id` metadata, Stripe's logs show the idempotency keys, and a repeated approve creates no second PaymentIntent.

#### CO-304 · Fronting on Stripe · Must

- **Files:** none
- **Depends on:** CO-303, VO-211
- **Done when:**
  - [ ] Check: Person 4 claims and approves. Stripe shows a $42 capture on Person 4's PaymentIntent and one $42 partial refund on Person 1's. Running `settleFrontedShare` again creates no second refund. Person 4's lane reads "Paid".

#### CO-305 · Concurrency and webhook suites on Stripe test mode · Must

- **Files:** `web/tests/payments/kit.ts` (the Stripe test-mode branch)
- **Depends on:** CO-210, CO-212, CO-301, CO-302
- **Produces:** the Stripe branch of the payments test kit. It creates real test-mode customers with `pm_card_visa`, and reads each PaymentIntent's real events through the Events API. It delivers them to `handleStripeEvent` with signatures from `stripe.webhooks.generateTestHeaderString`, which is how a suite sends a real event twice, or in a different order than Stripe did, on demand.
- **Done when:**
  - [ ] `pnpm --filter web test:stripe -- tests/payments` passes. These are the CO-209, CO-210, and CO-212 suites against Stripe test mode (review point 4.3). Each suite also checks Stripe's side:
    - `Stripe shows exactly one PaymentIntent per payer for the mandate, even after parallel approvals`
    - `each PaymentIntent's amount_received equals the sum of the rows it pays`
    - `in the claim-after-capture test, Person 1's PaymentIntent has exactly one refund, for 4200`
  - [ ] Check: with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, one full booking flow and one claim record every real event once in `webhook_events`, all `processed`.
- **Commit:** `test(payments): concurrency and webhook suites on stripe test mode`

### M3 · VO

#### VO-303 · Dev toolbar with reset · Should

- **Files:** `web/src/features/demo/components/{dev-toolbar.tsx,dev-toolbar.test.tsx}`, `web/src/features/demo/server/run-demo-action.ts`, `web/src/app/api/demo/[action]/route.ts`
- **Depends on:** VO-216
- **Produces:** the dev-mode toolbar and `/api/demo/:action` with the `reset` action. CO-S01 adds `price-change`.
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/demo/components/dev-toolbar.test.tsx` passes:
    - `renders only in dev mode, at 1024 px or wider, at the bottom right`
    - `Reset runs the batch reset and broadcasts demo.reset`
    - `the button shows pending and is disabled while its action runs`
  - [ ] Check: the route returns 403 without `x-demo-token` or for a non-organizer, and 404 when dev mode is off.
- **Commit:** `feat(demo): dev toolbar with reset`

#### VO-304 · Run limits and uptime · Must

- **Files:** none
- **Depends on:** VO-107
- **Done when:**
  - [ ] Check: Vercel shows `maxDuration = 300` on `/api/messages`, so agent runs aren't cut off. The optimizer host (localhost until VO-S02, then Vultr, always on) is reachable. `/api/health` is green.

---

## Milestone 4: every flow end to end

The per-person export is built here, then all five core flows run end to end on real providers.

**Pass when all of these are true:**

- [ ] Starting from freshly seeded data, all five core flows (design §5) run end to end on real providers, twice in a row, with no manual reloads.
- [ ] Failures show up as the product intends. With the model unreachable, or FastAPI stopped, the plan request ends in an error card with Try again. A member who was offline for 10 s catches up. A used invite link says it was already used.
- [ ] `/trip/<slug>/mine` shows each member only their own attended items, with places, times, and payment status. Download serves a calendar file with one event per attended item, and the page prints cleanly.

**If it fails:** Should work stops until the failing flow passes.

### M4 · AI

#### AI-404 · Record the real agent runs · Should

- **Files:** `web/scripts/demo/fixtures/agent-recordings/*.json` (all three, regenerated together; each owner reviews the diff of their own file)
- **Depends on:** AI-213, Milestone 3 passed
- **Done when:**
  - [ ] Check: one real run from freshly seeded data, with `AGENT_RECORD=1`, rewrites the three recordings. Then, with `LLM_PROVIDER=mock`, the same prompts produce the same card types for the same item handles, and the e2e suites still pass.
- **Commit:** `chore(demo): record real agent runs for tests`

### M4 · VO

#### VO-406 · Failure-mode checks · Should

- **Files:** none
- **Depends on:** AI-304, FE-304, CO-303
- **Done when:**
  - [ ] Check: each failure behavior in the Milestone 4 criteria holds on the deployed app.

### M4 · FE

#### FE-404 · Per-person itinerary export · Must

- **Files:** `web/src/app/trip/[slug]/mine/page.tsx`, `web/src/features/itinerary/components/{my-itinerary-view.tsx,my-itinerary-view.test.tsx}`, `web/src/features/itinerary/server/{build-itinerary-export.ts,build-itinerary-export.test.ts}`, `web/src/app/api/trips/[id]/itinerary/{route.ts,route.test.ts}`, `packages/shared/src/api/itinerary.ts`
- **Depends on:** FE-206, FE-208, CO-213
- **Produces:** `MyItineraryView` and `buildItineraryExport({ tripId, memberId }) → { stops, totals }`, plus the download route serving one `VEVENT` per attended item as a calendar file.
- **Done when:**
  - [x] `pnpm --filter web test -- src/features/itinerary/components/my-itinerary-view.test.tsx src/features/itinerary/server/build-itinerary-export.test.ts src/app/api/trips` passes:
    - `shows only the signed-in member's attended items, in time order, each with place, time, attendees, and payment status`
    - `the calendar file has one event per attended item, with the place and start/end times`
    - `the download route returns 403 for a non-member`
    - `totals show the member's committed share and status`
  - [ ] Check: the page prints to one clean hand-off per member.
- **Status:** in progress (2026-09-26): the backend half is done; the page and components are FE's. Proof: `pnpm --filter web test src/features/itinerary/server src/app/api/trips` → 7 passed (RED first: missing modules), covering "the calendar file has one event per attended item…", "the download route returns 403 for a non-member", and "totals show…"; `pnpm --filter web test:db tests/db/itinerary-export.test.ts` → 2 passed through row-level security. `shareStatus` in `@agp/shared` gives every money surface the same words.
- **Commit:** `feat(itinerary): per-person itinerary with calendar download`

#### FE-405 · e2e 05-itinerary · Should

- **Files:** `web/e2e/05-itinerary.spec.ts`
- **Depends on:** FE-404, CO-214, VO-219, VO-217
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/05-itinerary.spec.ts` passes: `Person 2 opens /mine, sees only their own items with "Paid" statuses, and downloads a calendar file with one event per item`.
- **Commit:** `test(e2e): per-person itinerary flow`

#### FE-401 · Accessibility e2e · Should

- **Files:** `web/e2e/a11y.spec.ts`
- **Depends on:** VO-220, VO-217
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/a11y.spec.ts` passes: `axe finds no serious or critical violations on chat, plan, map, mine, invite, and profile`.
- **Commit:** `test(e2e): accessibility checks on every flow's views`

#### FE-402 · Interaction-state audit · Should

- **Files:** none of its own. Each issue goes to the file's owner as a one-line task.
- **Depends on:** Milestone 3 passed
- **Done when:**
  - [ ] Check: every button, tab, chip, and link in the core flows shows hover, active, focus-visible, disabled, and pending states per design §8.5. The keyboard alone can send, comment, and approve.

#### FE-406 · e2e 00-all-flows · Should

- **Files:** `web/e2e/00-all-flows.spec.ts`
- **Depends on:** AI-214, FE-222, CO-214, VO-219, FE-405
- **Done when:**
  - [ ] `pnpm --filter web e2e -- e2e/00-all-flows.spec.ts` passes: `the five core flows run in order with mocks: profile, plan a day, collaborate, pay, claim, then per-person itinerary`.
- **Commit:** `test(e2e): all core flows in one run`

### M4 · CO

#### CO-401 · Money reconciliation · Should

- **Files:** `web/scripts/demo/reconcile-stripe.ts`, `web/scripts/demo/lib/{reconcile.ts,reconcile.test.ts}`
- **Depends on:** CO-303
- **Done when:**
  - [ ] `pnpm --filter web test -- scripts/demo/lib/reconcile.test.ts` passes: `flags a share row whose Stripe capture or refund differs from the database`.
  - [ ] Check: after three full booking flows, reconciliation reports no mismatches and no orphaned PaymentIntents in the batch.
- **Commit:** `chore(payments): reconcile stripe against share rows`

---

## Should queue

Feature extensions, in priority order. Start them once your Must tasks in the current milestone pass.

#### FE-S01 · Agent trace sheet · Should

- **Files:** `web/src/features/chat/components/{agent-trace-sheet.tsx,agent-trace-sheet.test.tsx}`, `web/src/features/chat/hooks/use-agent-trace.ts`
- **Depends on:** AI-106
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/chat/components/agent-trace-sheet.test.tsx` passes: `lists each tool call with its name, input, status, and duration, in run order`.
- **Commit:** `feat(chat): agent trace sheet`

#### CO-S01 · Price-change rule, with a dev trigger · Should

- **Files:** `web/src/features/payments/server/handle-price-change.ts`, `supabase/migrations/<timestamp>_record_price_change.sql`, `web/src/features/payments/components/price-change-card.tsx`, `web/tests/db/price-change.test.ts`. A `price-change` action goes in VO's dev route (VO adds a one-line call).
- **Depends on:** CO-210, VO-303
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/price-change.test.ts` passes:
    - `a new total within the cap captures the new amount (auto_captured)`
    - `a drop captures the lower amount (auto_captured_lower)`
    - `above the cap cancels the mandate, releases the holds, and creates a superseding mandate for re-approval`
    - `record_price_change rejects a non-member actor with not_permitted`
- **Commit:** `feat(payments): price-change rule`

#### AI-S05 · Model summary line on the plan card · Should

- **Files:** `web/src/lib/tools/plan-day/{summary-line.ts,summary-line.test.ts,card.tsx}`, `web/src/lib/agent/runner.ts`
- **Depends on:** AI-211
- **Produces:** at the end of a run that called `plan_day`, the runner offers the model's first sentence as the card's `summary_line`. It's kept only if every number in it appears in the card's facts (§11.3, item 8):

  ```ts
  /** Keeps the model's line only if it adds no numbers of its own. */
  export function keepSummaryLine(line: string, facts: string[]): string | null {
    const numbers = (text: string) => text.match(/\d+(?:[.:]\d+)?/g) ?? [];
    const allowed = new Set(facts.flatMap(numbers));
    return line.length <= 140 && numbers(line).every((n) => allowed.has(n)) ? line : null;
  }
  ```

- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/tools/plan-day/summary-line.test.ts` passes:
    - `keeps a line whose numbers all appear in the facts`
    - `drops a line with a price that isn't in the facts`
    - `drops a line longer than 140 characters`
    - `the card shows the line when it's kept, and nothing when it's dropped`
- **Commit:** `feat(agent): fact-checked summary line on the plan card`

#### CO-S02 · Declines and covering the shortfall · Should

- **Files:** `web/src/features/payments/server/{decline-hold.ts,cover-shortfall.ts}`, `web/src/app/api/mandates/[id]/{decline,cover}/route.ts`, `web/tests/db/decline-cover.test.ts`
- **Depends on:** CO-210
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/decline-cover.test.ts` passes:
    - `a decline moves the mandate to partially_declined`
    - `the organizer covering the shortfall adds a fronted row to their hold, and the mandate proceeds`
    - `the organizer cancelling releases every hold`
- **Commit:** `feat(payments): declines and organizer cover`

#### AI-S02 · `summarize` tool · Should

- **Files:** `packages/shared/src/tools/summarize.ts`, `packages/shared/src/cards/summary.ts`, `web/src/lib/tools/summarize/{tool.ts,card.tsx,tool.test.ts}`
- **Depends on:** AI-106, CO-213
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/tools/summarize` passes:
    - `every number is computed on the server`
    - `Person 4's share shows fronted until they pay`
    - `logistics has 5 lines or fewer`
- **Status:** done, backend (2026-09-26). Proof: `pnpm --filter web test src/lib/tools/summarize` → 4 passed (RED first: `buildSummary` didn't exist); `pnpm --filter web test:db tests/db/summarize.test.ts` → 2 passed (a scripted run posts one `summary` card with committed $84 from the seeded holds; an unknown `M9` returns a correctable `unknown_handle` and no card). `SummarizeInput` and `SummaryCard` are final in `@agp/shared`; `formatUsd` is exported for server text. The card renderer (`summarize/card.tsx`) stays a stub for FE, and CO-213's badge reads the same `shareStatus` labels.
- **Commit:** `feat(agent): summarize tool`

#### FE-S02 · Create-trip flow · Should

- **Files:** `supabase/migrations/<timestamp>_create_trip.sql`, `web/src/app/trips/new/page.tsx`, `web/src/app/api/trips/route.ts`, `packages/shared/src/api/trips.ts`, `web/tests/db/create-trip.test.ts`
- **Depends on:** FE-202
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/create-trip.test.ts` passes:
    - `create_trip makes the caller the organizer and returns an 11-character slug`
    - `a caller with no session is rejected`
  - [ ] Check: the form validates the title, city, and date, with disabled and pending states on Create.
- **Commit:** `feat(trips): create a trip`

#### AI-S04 · `search_places` tool and Google Places · Should

- **Files:** `packages/shared/src/tools/search-places.ts`, `packages/shared/src/cards/place-list.ts`, `web/src/lib/providers/places/{real.ts,mock.ts,index.ts,real.test.ts}`, `web/src/lib/optimizer/find-places.ts`, `web/src/lib/tools/search-places/{tool.ts,card.tsx}`
- **Depends on:** AI-207
- **Done when:**
  - [ ] `pnpm --filter web test -- src/lib/providers/places src/lib/tools/search-places` passes:
    - `findPlaces calls the provider only when the cache has fewer than max_results`
    - `a live search upserts into places`
    - `results without the requested dietary tags are dropped`
- **Commit:** `feat(agent): search_places with google places`

#### VO-S01 · Sentry · Should

- **Files:** `web/src/instrumentation.ts`, `optimizer/app/observability.py`. The AI engineer adds the one-line import to `optimizer/app/main.py`.
- **Depends on:** VO-107
- **Done when:**
  - [ ] Check: a thrown test error shows up in Sentry tagged with `trip_id`, `run_id`, `tool`, and `provider`.
- **Commit:** `chore(ops): sentry in web and optimizer`

#### VO-S02 · Optimizer on Vultr (last) · Should

- **Files:** `planning/checklist.md` (B9 Vultr runbook)
- **Depends on:** VO-107
- **Produces:** the optimizer image (from VO-107's `optimizer/Dockerfile`) running on a Vultr Cloud Compute host with Docker, with `OPTIMIZER_URL` on Vercel pointing at it. Do this task last: all testing runs against `http://localhost:8000` until then.
- **Done when:**
  - [ ] Check: `curl https://<vultr-host>/health` returns ok, and `curl https://<vercel-url>/api/health` returns all `ok` with `OPTIMIZER_URL` set to the Vultr URL. The container restarts on reboot (`--restart unless-stopped`).
- **Commit:** `chore(deploy): optimizer on vultr`

#### FE-S04 · Presence avatars · Should

- **Files:** `web/src/components/trip-shell/{presence-avatars.tsx,presence-avatars.test.tsx}`
- **Depends on:** FE-201
- **Done when:**
  - [ ] `pnpm --filter web test -- src/components/trip-shell/presence-avatars.test.tsx` passes: `shows each present member's initials in their lane color, with their name as the accessible label`.
- **Commit:** `feat(ui): presence avatars`

#### FE-S05 · "I'm attending" toggle · Should

- **Files:** `web/src/features/itinerary/components/attending-toggle.tsx`, `supabase/migrations/<timestamp>_set_organizer_attending.sql`
- **Depends on:** FE-206, AI-209
- **Done when:**
  - [ ] Check: turning it off removes the organizer from new plans. The organizer still approves fronted shares.
- **Commit:** `feat(itinerary): organizer attending toggle`

#### FE-S06 · Request-to-join screen · Should

- **Files:** `web/src/app/trip/[slug]/request-to-join.tsx`
- **Depends on:** FE-106
- **Done when:**
  - [ ] Check: a signed-in non-member sees only the trip title and a request message, with no trip data.
- **Commit:** `feat(ui): request-to-join screen for non-members`

#### CO-S04 · Mandate expiry · Should

- **Files:** `web/src/features/payments/server/expire-mandates.ts`, `web/tests/db/expire-mandates.test.ts`
- **Depends on:** CO-210
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/expire-mandates.test.ts` passes: `an open mandate past expires_at is cancelled with reason expired, and its holds are released`.
- **Commit:** `feat(payments): expire open mandates`

#### CO-S05 · Hotels through Duffel Stays · Must

- **Files:** `web/src/lib/providers/booking/{stays-real.ts,stays-real.test.ts,mock-merchant.ts,index.ts}`, `packages/shared/src/money/decimal.ts`
- **Depends on:** CO-204. The `real` check also needs Duffel Stays access on the account and a `duffel_test_` token.
- **Produces:** `@duffel/api` 4.30.0 (server-only) behind the `BookingProvider` interface. Duffel's flow is search → fetch all rates → quote → booking; ours maps `optionId` to Duffel's `rate_id`, `quote()` to `stays.quotes.create(rate_id)`, `book()` to `stays.bookings.create({ quote_id, guests, email, phone_number })`, and `cancel()` to `stays.bookings.cancel(id)`. Duffel sends money as decimal strings (`total_amount`), which are parsed to integer cents without floats. Every call goes through `withPolicy`, because the client has no timeout setting. A booking isn't retried blindly: after an error, `book()` looks the booking up by quote before trying again. Search (`stays.search` by coordinates and radius) is a tool for Muse, not part of the adapter.
- **Done when:**
  - [x] `pnpm --filter web test src/lib/providers/booking` and `pnpm --filter @agp/shared test src/money/decimal.test.ts` pass: decimal strings to cents (`"123.45"` → 12345, and rejecting `"1.234"`), quote and book through a fake Duffel client, an unavailable rate becoming a failed book, and `getBookingProvider("stays")` choosing the mock or real adapter from `STAYS_PROVIDER`.
  - [ ] Check: with `STAYS_PROVIDER=real` and a test token, a Duffel test property quotes and books.
- **Status:** adapter done (2026-09-26); the `real` check is blocked on the token and Stays access. Proof: `stays-real.test.ts` → 10 passed, `mock-merchant.test.ts` → 6 passed (RED first: no `selectStaysProvider`), `decimal.test.ts` → 17 passed (RED first: no module); web unit 224, shared 63, typecheck and lint clean. The hotel mock is the mock merchant with `kind: "stays"` (prices from `item_options`), so no separate mock file. Duffel's Stays booking has no idempotency key, so `book()` tags the booking's `metadata` with ours and looks for it before creating and again after an ambiguous failure; a create is never retried. Duffel quotes carry no expiry, so the adapter bounds a quote at 10 minutes. Not wired yet: `create_mandate` and `finalizeMandate` still ask for `tickets`, and a stays mandate needs a lead guest's email and phone (AI-217's profile data or the approval card).
- **Commit:** `feat(booking): stays through duffel`

#### AI-217 · Remember each person's preferences · Must

- **Files:** `supabase/migrations/<timestamp>_person_preferences.sql`, `web/src/lib/tools/remember-preference/tool.ts`, `web/src/lib/agent/context.ts`, `web/tests/db/person-preferences.test.ts`
- **Depends on:** AI-209, VO-220
- **Produces:** a `person_preferences` row per signed-in user, across trips. It holds dietary rules, interests, a budget style, and short notes Muse has learned, each with its source trip and time. RLS: a user reads and edits only their own row, and the agent reads it with the admin client. When a member joins a trip, their preferences seed `member_constraints`. The agent context lists each attending member's preferences, so Muse chooses among `plan_day`'s ranked options from the conversation and that memory. A `remember_preference` tool saves what a person says about themselves ("I'm vegetarian", "I hate early starts"); it never records something one member says about another.
- **Done when:**
  - [ ] `pnpm --filter web test:db -- tests/db/person-preferences.test.ts` passes: a user can't read another user's row; joining a trip copies dietary rules and interests into `member_constraints`; `remember_preference` updates only the speaker's row; the rendered context names each attending member's remembered preferences.
- **Commit:** `feat(agent): remember each person's preferences`

---

#### VO-S03 · Voice notes: transcription provider and route · Should

- **Files:** `web/src/lib/providers/transcription/{real.ts,mock.ts,index.ts,real.test.ts,mock.test.ts}`, `web/src/lib/audio/{to-wav.ts,to-wav.test.ts}`, `web/src/app/api/voice-notes/{route.ts,route.test.ts}`, `packages/shared/src/api/voice-notes.ts`
- **Depends on:** FE-105, VO-103
- **Produces:** the transcription provider (`TRANSCRIBE_PROVIDER`; `muse-voice-transcribe-1.0` at `POST /v1/asr/transcribe`), `toWav(audioBuffer)` (16 kHz mono 16-bit PCM), and `POST /api/voice-notes` (design §2.5, ADR 0018).
- **Done when:**
  - [x] `pnpm --filter web test -- src/lib/audio src/lib/providers/transcription src/app/api/voice-notes` passes:
    - `toWav writes a 44-byte header for 16 kHz, mono, 16-bit, and a 1 kHz sine round-trips within one sample`
    - `the route rejects a non-WAV, stereo, 44.1 kHz, or over-2-minute upload with 400 before calling the provider`
    - `the real provider sends multipart request JSON (model, keywords) and the WAV, and parses the transcript` (fetch mocked)
    - `the transcript posts through sendMessage with the upload's client_id, so a retried upload posts once`
    - `a transcript with "@agent" starts one agent run`
  - [ ] Check: with `TRANSCRIBE_PROVIDER=real`, a 10-second voice note appears as the member's message within 5 s.
- **Status:** backend done; real check blocked (2026-09-26). Proof: `pnpm --filter web test src/lib/audio src/lib/providers/transcription src/app/api/voice-notes` → 10 passed (RED first: missing modules), adding a 5xx retry with no key in errors and a non-member refused before transcription. **Blocked:** the real check needs `META_MODEL_API_KEY`. The composer button is FE-S07.
- **Commit:** `feat(voice): voice notes through meta speech to text`

#### FE-S07 · Voice-note button in the composer · Should

- **Files:** `web/src/features/chat/components/{voice-note-button.tsx,voice-note-button.test.tsx,composer.tsx}`
- **Depends on:** VO-S03, FE-106
- **Done when:**
  - [ ] `pnpm --filter web test -- src/features/chat/components/voice-note-button.test.tsx` passes:
    - `the button is hidden when MediaRecorder or OfflineAudioContext is missing`
    - `recording shows an elapsed timer, and stops at 2 minutes`
    - `uploading shows pending with aria-busy; a failure keeps the recording and offers Try again`
    - `the button is at least 44 px and has an accessible name that changes with its state`
- **Commit:** `feat(chat): voice-note button`

## Parallelization

**What each engineer works on, per milestone.** Each cell lists that person's tasks, Must first. No two people edit the same file within a milestone. Files that change hands between milestones are listed in the next table.

| Milestone | FE engineer | AI engineer | CO engineer | VO engineer |
| --- | --- | --- | --- | --- |
| **M1** | App, tokens, card frame, send route, chat, Realtime: FE-101–107 | FastAPI stub, contracts, web skeleton, LLM, context, runner, `plan_day` slice: AI-101–107 | Schema files 2–4, `apply_plan` and the function audit, `withPolicy`: CO-101–105. Should: CI and lint rules (CO-106) | Repo, schema file 1, env, clients, seed, sign-in, deploy: VO-101–107 |
| **M2** | Trip view model first (FE-204), then three tracks in parallel. Lanes: FE-206, FE-220. Map: FE-210, FE-211. Data: FE-209, FE-218. Also shell, trip list, person filter, recovery, comments, and profile: FE-201, FE-202, FE-208, FE-214, FE-219–221. Should: FE-207, FE-212, FE-213, FE-215, FE-216, FE-222 | Test double; scoring interface first (AI-202), then scoring, both engines, and the request builder in parallel; `plan_day`, re-plan from comments, `update_item`, plan card, queue: AI-201–207, AI-209–212, AI-216. Should: AI-208, AI-213, AI-214 | Contracts, money, payments mock, booking, mandates, tool, approvals with the Stripe webhook route, finalize, fronting, badge; concurrency suites on mocks: CO-201–204, CO-207–210, CO-212, CO-213. Should: CO-214 | Webhooks, claim, invite page, joined card, booking and approval cards (VO-213, VO-214, moved from CO), profile route: VO-203, VO-209–211, VO-213, VO-214, VO-220. Should: VO-201 (do it early), VO-215–217, VO-219 |
| **M3** | ORS switch, badge in lanes, lanes and map check: FE-301–303. Should: FE-304, FE-305 | Meta switch, plan check, comment-driven re-plan: AI-301–303. Should: AI-304 | Stripe provider, customers, Stripe switch, fronting on Stripe, concurrency suites on Stripe test mode: CO-301–305 | Run limits: VO-304. Should: VO-303 |
| **M4** | Per-person export: FE-404. Should: FE-401, FE-402, FE-405, FE-406 | Should: AI-404 | Should: CO-401, then the Should queue | Should: VO-406 |
| **Should queue** | FE-S01, FE-S02, FE-S04–S07 | AI-S02, AI-S04, AI-S05 | CO-S01, CO-S02, CO-S04, CO-S05 | VO-S01–S03 |

**Must tasks per engineer and milestone**, as `check_plan.py` prints them. One person works serially, so these bound each milestone:

| Milestone | FE | AI | CO | VO |
| --- | --- | --- | --- | --- |
| M1 | 8 | 7 | 6 | 7 |
| M2 | 13 | 12 | 10 | 7 |
| M3 | 3 | 3 | 5 | 1 |
| M4 | 1 | 0 | 0 | 0 |

**Files that change hands.** Each file has one owner at a time. Hand-offs happen at milestone boundaries, except the two moved cards, which VO owns from the start.

| File | First owner | Owner after that |
| --- | --- | --- |
| `web/src/features/itinerary/server/apply-plan.ts` and the `apply_plan` SQL | CO (CO-104, M1) | AI, from M2 |
| `.github/workflows/ci.yml`, `web/eslint.config.mjs` | CO (CO-106, M1) | VO, from M2 |
| `web/src/lib/reliability/*` | CO (CO-105, M1) | VO, from M2 |
| `web/package.json`, `pnpm-lock.yaml`, `web/playwright.config.ts`, `web/vitest.config.ts` | FE (FE-101, FE-102, M1) | VO, from M2 |
| `web/scripts/demo/fixtures/saturday-trip.json` | VO (VO-105, M1) | AI, from M2 |
| `web/scripts/demo/fixtures/agent-recordings/*` | each prompt's owner (M2) | AI regenerates all three in AI-404; owners review their own file |
| Approval card UI: `features/payments/components/approval-card.tsx`, `features/payments/lib/approval-copy.ts`, `features/payments/hooks/use-mandates.ts`, `lib/tools/propose-purchase/card.tsx` | VO (VO-214) | — (inside CO's feature, owned by VO) |
| `features/booking/components/booking-confirmed-card.tsx` | VO (VO-213) | — (inside CO's feature, owned by VO) |

**Cross-workstream waits.** Each row lists a task and the tasks it waits on. Plan around them first.

| Milestone | Task → waits on |
| --- | --- |
| M1 | CO-101 → VO-102 (pushed first) · AI-105 and FE-105 → CO-102 (types) · FE-104 and VO-106 → AI-103 · AI-107 → CO-104, CO-105 · VO-107 → AI-101 |
| M2 | FE-204 → AI-102 · FE-218 → CO-101 · AI-209 → FE-209 · AI-211 → FE-218 · AI-216 → AI-210 · FE-220 → FE-206 · FE-221 → VO-220 · CO-209 → VO-203 · CO-213 → VO-214 · VO-211 → CO-212 · VO-213 → CO-201 · VO-214 → CO-202, CO-209. Should: FE-222 → FE-220, AI-216, VO-201, VO-217 · CO-214 → CO-208, AI-214, VO-214, VO-217 · VO-219 → CO-212, CO-214 |
| M3 | FE-302 → CO-213 · FE-303 → AI-302 · CO-304 → VO-211 · AI-303 → AI-216 |
| M4 | FE-404 → FE-208, CO-213. Should: FE-405 → FE-404, CO-214, VO-219 · FE-406 → every e2e flow spec |

**Could VO own the map track?** 4.2b made it independent (FE-204 → FE-210 → FE-211), so this was checked, not done:

- **Files would collide in one place.** FE-212 (Should) edits `features/map/components/stop-marker.tsx` and `features/itinerary/components/item-block.tsx`, so it would have to split by owner. Everything else is clean:
  - The map page is now created by FE-210 alone.
  - The map track only imports `lib/trip-view`, the tokens, and `features/map`'s barrel, which is frozen.
  - `features/map/server/ensure-routes.ts` stays with FE's data track.
  - `components/ui/map.tsx`, the generated mapcn component, would hand off to VO at M2.
- **Load says no.** VO has 7 Must tasks in M2 against FE's 13. The map track would make it 9 against 11, and VO's claim and card work is on the critical path.
- **Recommendation:** keep the map with FE unless VO finishes early.

---

## Flow map

This map shows that every Must task sits under a core user flow (design §5), or under the foundation and enablers that every flow runs on. Should tasks don't appear here.

| Core flow | Must tasks |
| --- | --- |
| Foundation and enablers (every flow) | FE-101–108, FE-201, FE-214, AI-101–106, AI-212, CO-101–105, VO-101–107, VO-304 |
| 5.1 Create profile | FE-221, VO-220 |
| 5.2 AI-guided trip planner | FE-204, FE-206, FE-209–211, FE-218, FE-301, FE-303, AI-107, AI-201–207, AI-209, AI-211, AI-217, AI-301, AI-302 |
| 5.3 Invite and collaborate | FE-220, AI-210, AI-216, AI-303, VO-209–211 |
| 5.4 Group pay after confirmation | CO-107, CO-201–204, CO-207–210, CO-212–213, CO-301–305, CO-S05, VO-203, VO-213, VO-214, FE-219, FE-302 |
| 5.5 Per-person itinerary | FE-202, FE-208, FE-404 |

---

## Critical path

`python planning/tools/check_plan.py` computes the longest dependency chain and the per-engineer counts from the Depends on lines. Re-run it after changing any dependency. It counts each Must task as one step of about 30 minutes.

**Planner (4.2).** AI-202 defines the scoring interface and fixtures. After it, scoring (AI-203), both engines (AI-204, AI-205), and the request builder (AI-207) are independent. The engines chain is 6 tasks deep, down from 10 in a row.

**Frontend (4.2b).** FE-204 defines the trip view model and its fixtures, including the provisional dinner pin. After it, three tracks are independent:

```text
FE-102, AI-102 → FE-204 ─┬─ lanes: FE-206 → FE-220
                         ├─ map:   FE-210 → FE-211
CO-101 ──────────────────┴─ data:  FE-218 (rows → view)        FE-209 routing runs beside it
```

Removed dependencies that were only for convenience:

- FE-204 → FE-107: the view model doesn't need Realtime.
- FE-211 → FE-209: legs arrive in the view model.
- FE-218 → FE-206, FE-210, FE-211: the adapter doesn't need the components.
- FE-201's plan and map page files: each track now creates its own page.

**Before and after 4.2b:**

| | Longest dependency chain |
| --- | --- |
| Before (14 Must tasks) | VO-101 → FE-101 → FE-102 → VO-103 → VO-104 → FE-103 → FE-104 → FE-106 → FE-107 → FE-204 → FE-206 → FE-218 → FE-301 → FE-303 |
| After (13 Must tasks) | VO-101 → FE-101 → FE-102 → VO-102 → CO-101 → CO-102 → CO-103 → CO-207 → CO-209 → CO-210 → CO-212 → VO-211 → CO-304 |

The longest chains within Frontend's own work are now 8 (lanes, through FE-220's comments), 6 (map), and 6 (data). FE-303 reaches 12, but only because it checks a real Muse Spark plan (AI-302).

A second chain runs through planning into collaboration: … AI-106 → AI-107 → AI-209 → AI-210 → AI-216 → AI-303. So in Milestone 2, protect CO's money chain (CO-207 → CO-209 → CO-210 → CO-212) and the comment-revision chain (AI-209 → AI-210 → AI-216) from interruptions.

## Riskiest tasks

1. **CO-210 and CO-212, finalizing and fronting.** They sit on the longest dependency chain, and they're concurrency plus money: one winner, one paying row per share, exactly one refund. Webhooks can arrive twice or early. Mitigations:
   - `planCaptures` as one pure function, with `pays_share` written before any capture.
   - Conditional updates, and idempotency keys from our own IDs.
   - The same concurrency and webhook suites run on mocks in M2 and on Stripe test mode in CO-305.
2. **AI-216, comment-driven revision through `update_item`.** It joins the engines chain and the `plan_day` chain, and the collaborate flow depends on the model asking for the right revision. Mitigations: AI-210's supersede machinery is built and tested first, and the e2e spec (FE-222) pins one comment-to-revision turn.
3. **AI-210, re-planning through `apply_plan`.** It's plpgsql that supersedes items and shifts times, and it joins both the engines chain and the `plan_day` chain. Mitigations: AI-207 computes the shift in a pure, tested function first, and `test_seeded_replan` fails loudly if the seed or the hours drift.

Next in line: AI-301. If Muse Spark picks the wrong tool, the user sees the wrong card, so the prompt checks run 5 of 5 before the switch counts.
