# Setup checklist

Two lists: accounts and keys (section A), then the scaffold, in order (section B). The build itself (tasks, milestones, and pass criteria) is in [`plan.md`](plan.md).

## A. Accounts, keys, and vendor setup

Keep keys in a shared password manager, never in the repo. Each line names the variable it fills (see [design §9](design.md#9-environment-variables)).

- [ ] **xAI:** console account and a test call to Grok 4.7 in the Playground → `XAI_API_KEY`
- [ ] **Google AI Studio:** Gemini key → `GOOGLE_GENERATIVE_AI_API_KEY`
- [ ] **Twilio:** account upgraded (no trial notice), and a voice-capable US number bought
- [ ] **ElevenLabs Agents:**
  - Twilio number imported → `ELEVENLABS_PHONE_NUMBER_ID`
  - Agent created → `ELEVENLABS_AGENT_ID`
  - API key → `ELEVENLABS_API_KEY`
- [ ] **ElevenLabs agent setup (dashboard):**
  - Prompt: polite reservation caller, using the dynamic variables `call_id`, `restaurant`, `party_size`, `preferred_time`, `earliest`, `latest`, `name`, `notes`
  - Server tool `confirm_reservation(call_id, confirmed_time, party_size, name, notes?)` with the header `x-tool-secret` → `ELEVENLABS_TOOL_SECRET`
  - Post-call webhook secret → `ELEVENLABS_WEBHOOK_SECRET`
  - Data collection fields: `confirmed_time`, `party_size`
- [ ] **ElevenLabs test:** one outbound call from the dashboard to a teammate's phone. That number → `VOICE_TO_NUMBER_OVERRIDE` (E.164). It goes only in `web/.env.local` and the Vercel env, never in docs, commits, or chat; `.env.example` keeps `+15555550100`.
- [ ] **Duffel:** test token → `DUFFEL_ACCESS_TOKEN`; request Stays access (optional; no core flow needs it)
- [ ] **Stripe:** test mode account → `STRIPE_SECRET_KEY` (`sk_test_…`); Stripe CLI installed and `stripe login` done
- [ ] **Google Places API (New)** key → `GOOGLE_PLACES_API_KEY`
- [ ] **OpenRouteService** key → `ORS_API_KEY`
- [ ] **Supabase:**
  - Project created → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and the project ref
  - Email one-time codes and anonymous sign-ins enabled
  - Private bucket `trip-photos` created
- [ ] **Vercel, Railway, Sentry, and ngrok** accounts; Vercel and Railway CLIs installed; `vercel login` and `railway login` done
- [ ] **UI reference:** Muse screenshots saved
- [ ] **Seed content:**
  - About 24 past-trip photos with timestamps (3 near-duplicates on purpose)
  - About 12 Atlanta venues with hours, prices, and tags

## B. Scaffold, in order

Commands are for bash (macOS, Linux, or Git Bash on Windows). Run them from the repo root unless a step says otherwise. Write project code from [`design.md`](design.md) and [`plan.md`](plan.md); Milestone 1 in the plan covers these steps task by task.

### B1. Verify versions before installing anything

```bash
for p in next@16.3.5 react@19.3.0 react-dom@19.3.0 typescript@6.0.3 tailwindcss@4.3.3 shadcn@4.21.0 \
  maplibre-gl@6.10.0 ai@7.0.109 @ai-sdk/xai@5.0.5 @ai-sdk/google@4.0.76 zod@4.6.5 \
  @supabase/supabase-js@2.116.0 @supabase/ssr@0.12.7 stripe@22.6.2 @elevenlabs/elevenlabs-js@2.68.0 \
  @tanstack/react-query@5.103.2 motion@13.4.0 sonner@2.0.8 nanoid@6.0.1 exifr@7.1.3 @duffel/api@4.30.0; do
  npm view "$p" version >/dev/null 2>&1 && echo "ok       $p" || echo "MISSING  $p"
done
for p in fastapi/0.141.1 uvicorn/0.53.0 pydantic/2.13.5 ortools/9.15.6755 pillow/12.3.0 httpx/0.28.1; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://pypi.org/pypi/$p/json)  $p"   # 200 = exists
done
curl -s https://pypi.org/pypi/imagehash/json | python -c "import sys,json; print('imagehash', json.load(sys.stdin)['info']['version'])"
```

- [x] Every line prints `ok` or `200`. Replace any missing version with the nearest stable one, update `planning/stack.md`, and note the change in ADR 0001. — *done 2026-09-23: every npm pin `ok`, every PyPI pin `200`; stack.md updated*

### B2. Repo and workspace

```bash
git init
git add -A                                # AGENTS.md, skills/, planning/adr/, and .env* are gitignored
git commit -m "chore: add workspace config, license, and ignore rules"
corepack enable
corepack use pnpm@11
pnpm init
```

- [x] In the root `package.json`: — *done (`git init` and first commits 2026-09-25; no corepack, pnpm 11.5.3 global)*
  - `"private": true` and `"engines": { "node": ">=24" }`.
  - Scripts:
    - `dev`, `lint`, `typecheck`, `test`: fan out with `pnpm -r`.
    - `seed:demo`, `reset:demo`, `demo:process-photos`: run `pnpm --filter web exec tsx scripts/demo/<name>.ts`. Each is added with its script (VO-105, VO-216, VO-401), so the root never points at a missing file.
    - `db:types`: `supabase gen types typescript --linked > packages/shared/src/db/database.types.ts`.
    - `api:types`: `pnpm --filter @agp/shared exec openapi-typescript http://localhost:8000/openapi.json -o src/optimizer/openapi.ts`.
- [x] `pnpm-workspace.yaml` lists `web` and `packages/*`. — *done; also `supportedArchitectures` (arm64) and `savePrefix: ""`*

### B3. Next.js app

```bash
pnpm create next-app@16.3.5 web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --disable-git --yes
pnpm --filter web add --save-exact next@16.3.5 react@19.3.0 react-dom@19.3.0
pnpm --filter web add -D --save-exact typescript@6.0.3 tailwindcss@4.3.3 eslint@9
cd web
pnpm dlx shadcn@4.21.0 init
pnpm dlx shadcn@4.21.0 add button card badge avatar skeleton tabs textarea sheet dialog sonner
pnpm dlx shadcn@4.21.0 add @mapcn/map
pnpm add --save-exact maplibre-gl@6.10.0
mkdir -p public/maplibre && cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs public/maplibre/
cd ..
```

- [x] If `cp` can't find the worker files, list `web/node_modules/maplibre-gl/dist/`, copy the files mapcn's docs name, and point the map component's worker setting at `/maplibre/`. — *done: worker files in `web/public/maplibre/`; mapcn `map.tsx` deferred to FE-210 (design §11.4 item 7)*
- [x] `create-next-app` also writes `web/AGENTS.md` (Next.js guidance for coding agents). Keep it locally; `AGENTS.md` is gitignored at every depth. — *done*

### B4. Runtime and tooling dependencies

```bash
pnpm --filter web add --save-exact ai@7.0.109 @ai-sdk/xai@5.0.5 @ai-sdk/google@4.0.76 zod@4.6.5 \
  @supabase/supabase-js@2.116.0 @supabase/ssr@0.12.7 stripe@22.6.2 @elevenlabs/elevenlabs-js@2.68.0 \
  @tanstack/react-query@5.103.2 motion@13.4.0 sonner@2.0.8 nanoid@6.0.1 exifr@7.1.3 server-only @sentry/nextjs@10
pnpm --filter web add -D --save-exact prettier@3 vitest@4 @playwright/test @axe-core/playwright tsx
pnpm --filter web exec playwright install chromium webkit
```

- [ ] `@duffel/api@4.30.0` only if Stays access has been approved.

### B5. Shared contracts package

```bash
mkdir -p packages/shared/src/{tools,cards,api,db,optimizer}
cd packages/shared && pnpm init && cd ../..
pnpm --filter ./packages/shared add --save-exact zod@4.6.5
pnpm --filter ./packages/shared add -D --save-exact typescript@6.0.3 openapi-typescript@7
```

- [x] Set `"name": "@agp/shared"`, `"private": true`, and `"type": "module"` in `packages/shared/package.json`, then run `pnpm --filter web add @agp/shared@workspace:*`. — *done*
- [x] Stub the 7 tool schemas and 11 card schemas from design §2.1, so the barrel files are stable from Milestone 1 on. — *done*

### B6. Optimizer service

```bash
mkdir -p optimizer/app optimizer/tests && cd optimizer
python3.12 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install fastapi==0.141.1 uvicorn==0.53.0 pydantic==2.13.5 ortools==9.15.6755 pillow==12.3.0 httpx==0.28.1 imagehash==<version from B1> sentry-sdk
pip freeze > requirements.txt
pip install ruff pytest && pip freeze > requirements-dev.txt
uvicorn app.main:app --reload --port 8000                  # once app/main.py exists
cd ..
```

- [x] `GET http://localhost:8000/health` returns ok. Then run `pnpm api:types`. — *done: `pnpm api:types` wrote `packages/shared/src/optimizer/openapi.ts`*

### B7. Supabase

```bash
pnpm add -w -D --save-exact supabase
pnpm exec supabase init
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
# Create the four Milestone 1 files by hand with the fixed names in design §3.3 (20260925200100_foundation.sql …),
# not with `migration new`, so they always apply in the same order. Later files use `supabase migration new <name>`.
pnpm exec supabase db push
pnpm db:types
```

- [x] Files 1–4 from design §3.3 are pushed in order, with their tables, helper functions, transition triggers, RLS policies, and Realtime publication entries. File 5 (media) follows in Milestone 2 (`planning/plan.md`, VO-202). — *done locally: `supabase start` (553xx ports, no storage-api) + `migration up --local`; no linked project (design §11.4)*

### B8. Environment

```bash
cp web/.env.example web/.env.local && cp optimizer/.env.example optimizer/.env   # after writing both examples from design §9
```

- [x] `web/.env.example` has `VOICE_TO_NUMBER_OVERRIDE=+15555550100`. Put the real number only in `web/.env.local`. — *done*
- [x] The build profile runs: every provider set to `mock` except Supabase, and `NEXT_PUBLIC_DEMO_MODE=true`. — *done in `web/.env.example`; boot not yet verified*
- [ ] `pnpm --filter web dev` boots without env errors.

### B9. Deploy both services

```bash
cd web && vercel link && vercel env pull .env.vercel.local && vercel deploy && cd ..
cd optimizer && railway init && railway up && cd ..
```

- [ ] Railway start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. — *skipped: no deploys this run*
- [ ] Set every variable on Vercel and Railway, and set `OPTIMIZER_URL` to the Railway URL. — *skipped: no deploys this run*
- [ ] `GET https://<vercel-url>/api/health` reports `web`, `db`, and `optimizer` as ok. — *skipped: no deploys; checked locally in VO-107*

### B10. Webhooks and callbacks

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe       # copy the printed whsec_… into web/.env.local
ngrok http 3000                                                     # temporary URL for ElevenLabs during development
```

- [ ] **Stripe:** a dashboard webhook endpoint at `https://<vercel-url>/api/webhooks/stripe` for `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and `charge.refunded`. Its secret goes in Vercel's `STRIPE_WEBHOOK_SECRET`. — *skipped: no deploys*
- [ ] **ElevenLabs:** the server tool URL points at `https://<vercel-url>/api/voice/tools/confirm-reservation`, and the post-call webhook at `https://<vercel-url>/api/webhooks/elevenlabs`. Use ngrok URLs while developing locally. — *skipped: no deploys*

### B11. Quality gates and CI

- [ ] ESLint flat config with `no-restricted-imports` for feature and provider entry points (design §1), plus Prettier and `tsc --noEmit` in each package.
- [x] Ruff and pytest in `optimizer/`. — *done: ruff + pytest config in `optimizer/pyproject.toml`*
- [ ] Sentry wired in `web/src/instrumentation.ts` and in FastAPI, with tags `trip_id`, `run_id`, `tool`, and `provider`.
- [ ] `.github/workflows/ci.yml` has these jobs:
  - web and shared: `pnpm install --frozen-lockfile`, lint, typecheck, `vitest run`.
  - optimizer: `pip install -r requirements-dev.txt`, `ruff check`, `pytest`.
  - contracts: start uvicorn, run `pnpm api:types`, then `git diff --exit-code packages/shared/src/optimizer`.

### B12. Vertical slice: the Milestone 1 gate

The full pass/fail list is Milestone 1 in [`plan.md`](plan.md#milestone-1-scaffold-and-vertical-slice).

- [ ] In Person 1's browser session, the "@agent" mention starts a run.
- [ ] Grok calls `plan_day`, and FastAPI `/v1/plan` returns a stub.
- [ ] The Supabase write lands in one transaction (`apply_plan`).
- [ ] The Realtime refetch runs, and **the plan card renders in Person 2's session** without a reload.
- [ ] The same slice passes with `LLM_PROVIDER=mock`.
