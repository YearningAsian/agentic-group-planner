# Backend and data checklist

The short list to work from. Tick a box when its check passes, add or delete lines freely, and keep one line per task. The ID links a line to its full spec and proof in [planning/plan.md](planning/plan.md); a line without an ID is fine for small work. Frontend work lives in the plan, not here.

Last updated: 2026-09-26.

## Direction

- The optimizer returns feasible, ranked options. Muse picks one and explains it from the conversation and each person's remembered preferences. Don't tune weights for one fixture.
- Hotels go through Duffel Stays (`@duffel/api`); tickets stay on the mock merchant.
- Money is integer cents, statuses only move forward, and the agent proposes while a person approves.

## Next

- [ ] AI-217: remember each person's preferences across trips, and feed them to Muse
- [ ] Stays mandates: `create_mandate` and `finalizeMandate` use `getBookingProvider("stays")` for hotels, with a lead guest's email and phone
- [ ] Muse tool `search_stays`: Duffel `stays.search` by the trip's coordinates, results saved as places with rate options
- [ ] AI-208: seeded-trip test checks invariants, not an exact plan
- [ ] AI-210: re-planning from comments (`apply_plan` replan mode)
- [ ] VO-211: member joined, and holds released to the joiner (backend half)
- [ ] CO-S04: expire open mandates
- [ ] CO-S02: declines and covering the shortfall

## Before real Stripe (`PAYMENTS_PROVIDER=real`)

From the PR #3 review. Mock payments are unaffected.

- [ ] Refund webhooks: handle `refund.created` / `refund.updated` (charge events carry no refunds list)
- [ ] Approval lease longer than the Stripe calls it covers, or renewed before `authorize`
- [ ] A retry entry point for `finalizeMandate` and `settleFrontedShare` (sweeper or re-entry from `approveHold`)
- [ ] Re-release a late hold whose release failed
- [ ] Capture and release succeed when the PaymentIntent is already in that state
- [ ] Every card decline counts as declined, not retryable
- [ ] CO-302: seeded Stripe customers and claimer cards

## Blocked on accounts or keys

- [ ] Docker on this machine (DB tests run only in CI for now)
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (test mode): CO-303, CO-304, CO-305
- [ ] `META_MODEL_API_KEY` in `web/.env.local`: AI-301, AI-302, AI-303
- [ ] `DUFFEL_ACCESS_TOKEN` (`duffel_test_`) and Stays access: CO-S05's live check
- [ ] Hosted Supabase and Vercel: VO-101, VO-107

## Done (recent)

- [x] CO-S05: Duffel Stays booking adapter (`@duffel/api` 4.30.0) and the hotel mock; live check waits on a token

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
