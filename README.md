# Group Trip Agent

Group checkout for AI agents: **plan together, pay together, remember together.** A group chats about a trip and mentions `@agent`. The agent plans the day with real optimization, including split-up plans where people branch off and meet again. Everyone consents to their share before any charge. The agent calls a restaurant by phone to book dinner. After the trip, it builds a shared gallery and a recap.

> **Status:** early scaffold, Milestone 1 of 4 in progress. The shared contracts, database migrations, Supabase clients, reliability utilities, card infrastructure, and a stub optimizer exist. The agent runner, model providers, sign-in pages, chat, live updates, and seed scripts don't yet, so the app doesn't run end to end.

## What it does

1. **Plan a day.** "@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later." The optimizer returns scored options per slot, including a split-up plan, shown as a plan card, per-person lanes, and a map.
2. **Vote.** Members vote on options, and a slot locks at a majority.
3. **Book with group approval.** Each member approves "up to $X" for their share, which places a card hold. The charge captures only when every share is covered. The organizer can front the share of someone who hasn't joined yet.
4. **Restaurant call.** A voice agent phones the restaurant, confirms a time mid-call, and the day re-plans around it.
5. **Claim a lane.** A member who was planned for before joining opens an invite link, sees their lane, and pays their share. The organizer is refunded if they fronted it.
6. **Recap.** After the trip, photos are pinned to stops with captions and best shots, and the agent writes a recap.

## Repo map

```text
web/               Next.js 16 app: chat, lanes, map, payments, voice, gallery, recap; agent runner and tools
packages/shared/   @agp/shared: Zod contracts, enums, generated database and optimizer types
optimizer/         FastAPI: OR-Tools CP-SAT planner and photo analysis (stateless)
supabase/          migrations: tables, row-level security, Realtime publication, write functions
```

## Run it

Requires Node 24+, pnpm 11, Python 3.12, and a Supabase project.

```bash
pnpm install
cp web/.env.example web/.env.local                               # fill in keys
pnpm exec supabase link --project-ref <project-ref> && pnpm exec supabase db push
pnpm --filter web dev                                            # http://localhost:3000
cd optimizer && uvicorn app.main:app --reload --port 8000        # in a second terminal
```

## Frameworks and services used

Next.js, React, Tailwind CSS, shadcn/ui, mapcn, MapLibre GL (CARTO basemap), Vercel AI SDK with Grok (xAI) and Gemini, Zod, Supabase (Postgres, Auth, Realtime, Storage), Stripe (test mode), ElevenLabs Agents with Twilio, Google Places, OpenRouteService, Duffel (optional), TanStack Query, Motion, Sonner, FastAPI, OR-Tools, Pillow, ImageHash, Sentry, Vercel, and Railway. Exact versions are in the lockfiles (`pnpm-lock.yaml`, `optimizer/requirements.txt`).
