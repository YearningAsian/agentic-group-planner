# Task plan: publish, audit fixes, Meta Model API move

Started 2026-09-25. This file is tracked; keep it free of secrets and personal names.

## 1. Publish and verify

- [x] Publish state: no commits, no remote, no GitHub repo.
- [x] Ignore coverage for env files, skills/, local agent notes, and agent folders.
- [x] gitleaks over the files git would publish: clean.
- [x] Decision: publish task_plan.md and planning/, except planning/adr/.
- [x] Hold back planning/master-plan.docx: personal names in its body and metadata.
- [x] .gitignore and check_plan.py follow the new tracked set; check_plan.py prints UTF-8 on Windows.
- [x] README status line tells the truth; drop create-next-app boilerplate and starter SVGs.
- [x] Verification: typecheck, lint, tests (web, shared, optimizer), check_plan.py.
- [x] First commits (Conventional Commits), then push. The repo appeared (empty) between checks; pushed into it, no second repo.
- [x] Remote tree has none of the ignored paths; gitleaks over full history.
- [x] Secret scanning and push protection on; report status.
- [x] gitleaks pre-commit hook; CONTRIBUTING.md.
- [x] supabase/config.toml: explain the non-default settings.

## 2. Audit fixes

- [x] Reset M1 tasks that fail their done criteria: VO-101, VO-102, VO-104, CO-101, CO-102, CO-103. FE-103 reset, fixed, re-verified.
- [x] Remove false claims: "no scaffold" (README), health check (design §11.4), session persistence (VO-104).
- [x] Homepage links only to routes that exist; src/app/routes.test.ts guards it.
- [x] Seed commands removed until VO-105, VO-216, and VO-401 add them.
- [x] Anonymous and password auth replaced by magic links (ADR 0016; design, plan, db helper, config).
- [x] DB_TEST_TARGET option with keys in a gitignored web/.env.test.local (VO-108).
- [x] Stripe mock suites already planned (CO-203, CO-209, CO-210, CO-212; CO-305); Vitest globs fixed. Smoke spec is VO-217.

## 3. Meta Model API

- [x] Read the Meta Model API docs (dev.meta.ai); verified IDs, endpoints, and prices recorded in stack.md.
- [x] ADRs 0017 (Meta and clients), 0018 (WAV in the browser), 0019 (fee pass-through).
- [x] Code: env flags and tests, provider interfaces, migration, packages; fee function and copy rule.
- [x] Design §2.5 and §11.5; plan tasks CO-107, FE-108, FE-219 (Must) and VO-S03, FE-S07, AI-S06–S08, FE-S08 (Should).
- [x] xAI and Muse Glimmer recorded as possible later adapters (design §11.5 item 5).
- [ ] The rest of the section 3 feature list is missing (the message was cut off).

## Notes

- The local agent notes are stale: they say planning/ is gitignored and skills/ is tracked. Now the reverse.
- check_plan.py no longer flags "Meta" as an event word.

## 4. Journey pivot (2026-09-26): five flows, plan only

Started 2026-09-26. Docs only; no implementation. The end goal is now five steps: create profile, AI-guided trip planner, invite plus collaborate and edit, group paying after confirmation, per-person itinerary.

- [x] Decisions: restaurant call and recap/gallery dropped entirely; collaboration through item comments (not voting); per-person itinerary is exportable (screen plus calendar download).
- [x] `planning/design.md`: §5 rewritten to the five flows with sequence diagrams; tools 7→5 and cards 11→9 (no `call_restaurant`, `generate_recap`, `call_status`, or `recap`); no `votes`, `calls`, `photos`, or `recaps` tables (17 total); no voice, segmentation, image, or grounding providers; new `/profile` and per-person itinerary routes; §11.6 records the pivot and the dormant migration content.
- [x] `planning/plan.md`: goal, milestone criteria, and flow map rewritten; deleted vote, voice, photo, recap, and gallery tasks; new Must tasks FE-220 (comments), FE-221 (profile page), VO-220 (profile route), AI-216 (`update_item`), FE-404 (export); new e2e 02-collaborate (FE-222), 05-itinerary (FE-405), 00-all-flows (FE-406), 04-claim (VO-219); seed stages now `planned|discussed|booked`.
- [x] `planning/checklist.md`, `planning/stack.md`, `README.md`: voice/photo/recap vendors, keys, and setup removed.
- [x] `planning/tools/check_plan.py`: `.cursor/` added to the ignored tops, mirroring the working-tree `.gitignore`.
- [x] Verification: `python planning/tools/check_plan.py` → 127 tasks (83 Must, 44 Should), all checks passed.

## 5. Backend and data session (2026-09-26)

The per-feature log, with proofs and blockers, is in `planning/progress.md`.

- [x] Recovery: clean tree; AI-104 (`feat/agent-llm-provider`) merged into `colin-data-backend`; local Supabase stack up.
- [x] Feature 1: code aligned with the journey pivot (AI-102, AI-103, VO-103 re-verified; cleanup migration).
- [ ] Feature 2: agent context and runner (AI-105, AI-106).
- [ ] Feature 3: send-message route and the `plan_day` slice (FE-105, AI-107).
- [ ] Feature 4: seed script and health route (VO-105, VO-107).
