# Group Trip Agent

Group checkout for AI agents: **plan together, pay together, remember together.** A group chats about a trip and mentions `@agent`. The agent plans the day with real optimization, including split-up plans where people branch off and meet again. Everyone consents to their share before any charge. After the trip, each member keeps their own itinerary.

> **Status:** early scaffold, Milestone 1 of 4 in progress. The shared contracts, database migrations, Supabase clients, reliability utilities, card infrastructure, and a stub optimizer exist. The agent runner, model providers, sign-in pages, chat, live updates, and seed scripts don't yet, so the app doesn't run end to end.

## What it does

1. **Create profile.** A member signs in with a magic link and sets their name and avatar, shown in chat and lanes.
2. **Plan with the agent.** "@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later." The optimizer returns scored options per slot, including a split-up plan, shown as a plan card, per-person lanes, and a map.
3. **Invite and collaborate.** Members join from invite links and discuss items in comment threads; the agent revises the plan, and the organizer locks options to confirm them.
4. **Group pay after confirmation.** Each member approves "up to $X" for their share, which places a card hold. The charge captures only when every share is covered. The organizer can front the share of someone who hasn't joined yet.
5. **Per-person itinerary.** After confirmation, each member gets their own schedule with places and payment status, on screen and as a calendar download.

## Repo map

```text
web/               Next.js 16 app: chat, lanes, map, payments, profile, per-person itinerary; agent runner and tools
packages/shared/   @agp/shared: Zod contracts, enums, generated database and optimizer types
optimizer/         FastAPI: OR-Tools CP-SAT planner (stateless)
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

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md): it covers the gitleaks pre-commit hook and the checks to run.

## Frameworks and services used

Next.js, React, Tailwind CSS, shadcn/ui, mapcn, MapLibre GL (CARTO basemap), Vercel AI SDK with Meta's Model API (Muse Spark; speech to text for a Should feature) and Gemini as the fallback, Zod, Supabase (Postgres, Auth, Realtime), Stripe (test mode), Google Places, OpenRouteService, Duffel (optional), TanStack Query, Motion, Sonner, FastAPI, OR-Tools, Sentry, Vercel, and Vultr. Exact versions are in the lockfiles (`pnpm-lock.yaml`, `optimizer/requirements.txt`).
