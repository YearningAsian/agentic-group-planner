# Backend and data checklist

The short list to work from. Tick a box when its check passes, add or delete lines freely, and keep one line per task. The ID links a line to its full spec and proof in [planning/plan.md](planning/plan.md); a line without an ID is fine for small work. Frontend work lives in the plan, not here.

Last updated: 2026-09-26.

## Direction

- The optimizer returns feasible, ranked options. Muse picks one and explains it from the conversation and each person's remembered preferences. Don't tune weights for one fixture.
- Hotels go through Duffel Stays (`@duffel/api`); tickets stay on the mock merchant. Stripe and Duffel stay in **test/sandbox** only (`sk_test_`, `duffel_test_`); live keys are refused by the env loader.
- Money is integer cents, statuses only move forward, and the agent proposes while a person approves.

## Next

- [ ] Stays mandates: `create_mandate` and `finalizeMandate` use `getBookingProvider("stays")` for hotels, with a lead guest's email and phone (test-mode Duffel only: `duffel_test_`)
- [ ] Muse tool `search_stays`: Duffel `stays.search` by the trip's coordinates (sandbox), results saved as places with rate options
- [x] AI-217: remember each person's preferences across trips, and feed them to Muse
  - [x] migration + RLS + join trigger; agent context quotes remembered notes
  - [x] `remember_preference` tool (requester only; no card)
  - [x] CI db tests green (`person-preferences.test.ts`, PR #4)
- [ ] AI-210: re-planning from comments (`apply_plan` replan mode)
  - [x] migration + `applyPlan` replan: time shifts keep status; voting/decided slots superseded; booked refused
  - [x] `plan_day` accepts `mode: "replan"`; seeded replan optimizer test
  - [x] CI green (`replan.test.ts`, `test_seeded_replan.py`)
  - [ ] revision context quotes the item's comments; replan-mode non-member test
  - [ ] `update_item` `request_alternatives` (single-item replan path)
- [ ] VO-211: member joined, and holds released to the joiner (backend half)
  - [x] `MemberJoinedCard` schema; `afterClaim` moves shares and writes one card; claim route calls it
  - [x] CI db test green (`after-claim.test.ts`); the card component is frontend work
- [ ] CO-S04: expire open mandates (`expireMandates` done, CI db green; needs a scheduler caller)
- [ ] CO-S02: declines and covering the shortfall

## Before real Stripe (`PAYMENTS_PROVIDER=real`)

Needs `STRIPE_WEBHOOK_SECRET` (whsec_…) in `.env.local` — secret key is present locally; do not flip until webhook secret is set and these land:

- [x] Refund webhooks: handle `refund.created` / `refund.updated` (charge events carry no refunds list)
- [x] Approval lease: resolve customer/card before claim; 90 s lease covers authorize
- [x] Retry `finalizeMandate` / `settleFrontedShare` from `approveHold` when mandate is authorized/captured
- [x] Re-release a late hold whose release failed (and cancelled holds with a leftover PI)
- [x] Capture and release succeed when the PaymentIntent is already in that state
- [x] Every card decline with a PaymentIntent counts as declined, not retryable
- [ ] CO-302: seeded Stripe customers and claimer cards
- [ ] Set `STRIPE_WEBHOOK_SECRET` and only then `PAYMENTS_PROVIDER=real` (test mode)
- [x] Pending approval while a mandate is finalizing returns a retryable conflict (finalize retry only for members with no pending rows)

## Blocked on accounts or keys

- [ ] Docker on this machine (DB tests run only in CI for now)
- [x] `STRIPE_SECRET_KEY` (test) present locally — still need `STRIPE_WEBHOOK_SECRET` for CO-303+
- [ ] `META_MODEL_API_KEY` in `web/.env.local`: AI-301, AI-302, AI-303
- [x] `DUFFEL_ACCESS_TOKEN` (`duffel_test_`) present locally — Stays search returned 403 (request Stays access)
- [x] Hosted Supabase URL/keys present locally (project linked in `.env.local`) — VO-101 push still open
- [ ] Hosted Vercel: VO-107

## Done (recent)

- [x] CO-S05 review fixes: paginate booking lookup, map 401/403 to `internal`, re-find before failed, refuse hotel-arrival fees (test tokens only)
- [x] AI-208: seeded-trip test checks that every option is feasible, not one exact plan
- [x] CO-S05: Duffel Stays booking adapter (`@duffel/api` 4.30.0) and the hotel mock; live check waits on a `duffel_test_` token
- [x] CO-301: Stripe test-mode provider
- [x] CO-209: late holds released only when no row pays a share
- [x] No member visits a place twice in a day (both engines)
- [x] AI-209: `plan_day`, full version
- [x] AI-216: `update_item` and comment-driven revision
- [x] VO-209: claim an invite
- [x] VO-220: profile update route
- [x] AI-S02: `summarize` tool (backend)
- [x] CO-210, CO-212: finalize a mandate, fronting and refunds (mock payments)
- [x] Muse on Meta's Model API matches the docs: `https://api.meta.ai/v1`, `muse-spark-1.3`, `tool_choice: auto`, JSON-schema output, full tool-call replay, no `temperature` or `stop`
