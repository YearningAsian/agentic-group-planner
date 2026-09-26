# Split-view shell (scope B) — design

Date: 2026-09-26. Status: approved in brainstorm (browser vote `approve-shell` + terminal "approve shell").
Scope: trip entry choice + split-view shell on mocked TripView data only. Picker tools/cards and summary graph are follow-up specs, not this one.

## Context

`planning/design.md` + `planning/plan.md` describe the five post-pivot flows, but the code is pre-pivot and M1 scaffolding is incomplete (verified 2026-09-26 against the working tree):

- No `POST /api/trips`, no `trip/[slug]/` route. Entry lives in the draft system: `app/(trip-draft)/` + `features/trip-draft/` (`onboarding` = questionnaire start per `page.tsx`).
- `features/chat/server.ts` (`sendMessage`) and `features/chat/index.ts` (`ChatView`, `useMessages`) are `notBuilt` stubs. No `/api/messages`.
- No `lib/trip-view/`, `lib/realtime/`, or `lib/optimizer/`. `features/map/index.ts` (`MapView`) and `server.ts` (`ensureRoutes`) are stubs returning null. MapLibre workers exist in `public/maplibre/`.
- Card registry works but is pre-pivot: 7 tools / 11 card types in `lib/tools/registry.ts`, `lib/tools/cards.tsx`, `packages/shared/src/cards/index.ts`, `enums.ts` (includes `call_restaurant`, `generate_recap`, `call_status`, `recap`). Pivot wants 5/9.
- Real pattern to copy: `features/itinerary/server/apply-plan.ts` (CO-104, membership check, idempotent, pinned `search_path`).

So "reuse the TripView→map data flow" has no foundation yet. This spec builds the shell against a mock hook with the same component boundary, so the real TripView drops in later.

## Decisions (from brainstorming)

1. Entry choice lives at `(trip-draft)/onboarding` (replace existing questionnaire start, not a new `/trips/new` route).
2. Right map proves the flow with fly-to + single pin on mocked destination (no area circle in shell).
3. Questionnaire is a stepped mock: one question at a time, progress bar, Skip, tip text, Next/Back. Answers set mocked destination + dates.
4. Chat is local echo + mock detect: messages stay in local state, composer uses a fresh `client_id` per send and disables Send while pending; typing a mock-list city (Atlanta, Savannah, Asheville) sets destination and flies the map. Never calls `sendMessage`.

## Architecture

Client-only, no backend, no frozen-barrel edits, no new tools/cards. All state is React-local inside `(trip-draft)/`. The shell never imports future picker/graph code; those connect later only via Supabase + TripView + Realtime.

```
question-step / chat-mock → setMockTrip({destination, dates})
  → useMockTripView() → MapView (fly-to + pin)
  → destination + dates → left panel swaps in place to picker placeholder (no route change)
```

Approach B (chosen over pure-local-state shell and over real-Supabase-now): expose local state through a TripView-shaped mock hook so the view→map boundary is proven and the real TripView replaces one file.

## Components

1. `app/(trip-draft)/onboarding/page.tsx` (modify): two clear options, Questionnaire vs Chat. Writes `?entry=questions|chat`, links to the split view. Not a buried toggle.
2. Split shell (modify `app/(trip-draft)/studio/page.tsx`, which exists as an empty route today): two-panel grid — left guided/chat, right `MapView`. Mobile-first: stack on small screens, 44px targets, design tokens only.
3. `features/trip-draft/components/question-step.tsx` (new, trip-draft-owned): stepped mock. Steps: destination → dates → done (picker placeholder note). Progress, Skip (advances without value), tip line per step, Back.
4. `features/trip-draft/components/chat-mock.tsx` (new, trip-draft-owned): local message list, composer, naive city-detect against the 3-city mock list. Marked mock in code comments.
5. `features/map/index.ts` (shell-only `MapView` body, FE-owned): reads the mock hook only, flies to destination coords, drops one pin. Uses workers already in `public/maplibre/`.
6. `features/trip-draft/mock-trip-view.ts` (new, single mock file): `MockTripView` type (`{ destination: {label, lat, lng} | null, dates: {start, end} | null }`), `MOCK_CITIES` fixture, `useMockTripView()` hook. The only file the real TripView replaces. Marked `@deprecated-mock`.

Not touched: `packages/shared/src/cards/index.ts`, `web/src/lib/tools/cards.tsx`, `registry.ts`, `enums.ts`, migrations, picker/graph files.

## Error and empty states

- Empty: "Say hi, or pick a destination to see the map move."
- Unknown city in chat: no fly, inline hint listing the three mock cities.
- Map load failure: static fallback text. No silent mock swaps.

## Testing

Unit only (no `test:db`, no e2e — no backend): `question-step.test.tsx` (stepping, skip, progress), `chat-mock.test.tsx` (echo, Send disabled while pending, city-detect sets destination), `split-view.test.tsx` (in-place transition without navigation). `routes.test.ts` stays green. Gates: typecheck, lint, unit.

## Follow-ups (not this spec)

- Cleanup task: delete `call-restaurant/`, `generate-recap/`, `gallery/`, `recap/`, `voice/` + registry downgrade 7→5 / 11→9 per pivot, before picker lands.
- Picker spec + ADR (flight provider void — Duffel covers stays only; shortlist lifecycle option→mandate).
- Summary-graph spec (separate route, reads `useTripView` + Realtime only).
- One-line ADR note blessing or replacing the `MockTripView` shape when the real TripView owner builds it.
