# Stack: pinned versions

> **Verify on npm and PyPI before installing.** These versions come from the master plan §7 ("latest stable as of Sep 21, 2026"). Before changing any of them, run the check in [`checklist.md`](checklist.md#b1-verify-versions-before-installing-anything), fix any version that's missing, update this file, and record the date below. Versions are exact (`savePrefix: ""` in `pnpm-workspace.yaml`), and the lockfiles are committed.

- Last verified: **2026-09-23**, at Milestone 1 install. The B1 loop printed `ok` for every npm pin and `200` for every PyPI pin. Every "pin at install" row below now names its exact version. Newer releases exist for some pins (for example `maplibre-gl` 6.11.1); the pins were kept.
- Meta Model API and the AI packages re-verified **2026-09-25** on dev.meta.ai and npm (below). The model IDs are env defaults, so a newer model is a config change.
- Derived from: the master plan §7 (Sep 23 revision) and `Projects/STACK.md` (snapshot 2026-06-13, for Node and pnpm).
- Deviations from STACK.md: [ADR 0001](adr/0001-stack.md).

## Runtimes

| Tool | Version | Source | Notes |
| --- | --- | --- | --- |
| Node.js | 24.x LTS | STACK.md | `engines: { "node": ">=24" }`; Milestone 1 ran on Node 26.3.0 |
| pnpm | 11.5.3 | STACK.md | `packageManager: pnpm@11.5.3` |
| Python | 3.12.13 | plan §7 | Railway runtime; local venv through `uv python install 3.12` |
| TypeScript | 6.0.3 | plan §7 | not 7.x ([ADR 0010](adr/0010-typescript-6-over-7.md)) |

## web (Next.js)

| Package | Version | Notes |
| --- | --- | --- |
| next | 16.3.5 | |
| react / react-dom | 19.3.0 | |
| tailwindcss | 4.3.3 | CSS-first config, with `@tailwindcss/postcss` |
| shadcn (CLI) and mapcn | 4.21.0 | style `base-nova` (Base UI); mapcn installs through `shadcn add @mapcn/map` (FE-210) |
| maplibre-gl | 6.10.0 | mapcn requires ^6.3; worker files self-hosted |
| ai | 7.0.109 | server-side agent runner only; `@ai-sdk/react` is not used ([ADR 0005](adr/0005-cards-as-message-rows-realtime-refetch.md)) |
| @ai-sdk/openai-compatible | 3.0.53 | Meta Model API over Chat Completions: the agent loop, `generateObject`, `describeImage` ([ADR 0017](adr/0017-meta-model-api.md)). Shares `ai` 7.0.109's `@ai-sdk/provider` 4.0.17; 3.0.57 was latest on 2026-09-25 |
| openai | 7.23.0 | Meta Model API over the Responses API and images: search grounding, SAM, the recap cover. Latest on 2026-09-25; its peers are optional |
| @ai-sdk/google | 4.0.76 | Gemini fallback (`LLM_PROVIDER=google`) |
| zod | 4.6.5 | also in packages/shared |
| @supabase/supabase-js | 2.116.0 | |
| @supabase/ssr | 0.12.7 | |
| stripe | 22.6.2 | pin the API version in code. The browser packages from plan §7 are dropped ([ADR 0001](adr/0001-stack.md), item 7). |
| @duffel/api | 4.30.0 | optional: install only if Stays access is approved |
| @elevenlabs/elevenlabs-js | 2.68.0 | |
| @tanstack/react-query | 5.103.2 | |
| motion | 13.4.0 | |
| sonner | 2.0.8 | |
| nanoid | 6.0.1 | |
| exifr | 7.1.3 | |
| server-only | 0.0.1 | |

## web tooling (not in plan §7; pinned at install, 2026-09-23)

| Package | Version | Notes |
| --- | --- | --- |
| eslint | 9.39.5 | held at 9: the Next.js lint plugins aren't ready for 10; with `eslint-config-next` 16.3.5 |
| prettier | 3.9.9 | |
| vitest, vite | 4.1.11, 8.3.0 | `vite` is direct only for `loadEnv` in `vitest.config.ts` |
| @vitejs/plugin-react, jsdom | 6.1.1, 30.1.1 | component tests |
| @testing-library/react, dom, user-event, jest-dom | 16.3.3, 10.4.2, 14.6.7, 7.0.1 | |
| @playwright/test, @axe-core/playwright | 1.63.0, 4.13.0 | e2e with accessibility checks |
| @sentry/nextjs | 10.75.3 | its `@sentry/cli` install script is off until source maps are set up |
| tsx | 4.23.15 | runs `web/scripts/demo/*.ts` |
| @types/node, @types/react, @types/react-dom | 24.13.6, 19.3.0, 19.3.0 | |

## packages/shared

| Package | Version | Notes |
| --- | --- | --- |
| zod | 4.6.5 | the only runtime dependency |
| typescript | 6.0.3 | dev |
| openapi-typescript | 7.13.0 | dev; generates `src/optimizer/openapi.ts` |

## optimizer (FastAPI)

| Package | Version | Notes |
| --- | --- | --- |
| fastapi | 0.141.1 | |
| uvicorn | 0.53.0 | |
| pydantic | 2.13.5 | |
| ortools | 9.15.6755 | CP-SAT |
| pillow | 12.3.0 | |
| httpx | 0.28.1 | fetches signed photo URLs |
| imagehash | 4.3.2 | latest on 2026-09-23 |
| sentry-sdk | 2.70.0 | |
| ruff, pytest | 0.16.8, 9.1.1 | dev (`requirements-dev.txt`) |

## Command-line tools

| Tool | Version | Notes |
| --- | --- | --- |
| Supabase CLI (`supabase`) | 2.117.0 | root dev dependency; migrations, `start`, and `gen types` |
| Stripe CLI | latest | local webhook forwarding |
| Vercel CLI | latest | |
| Railway CLI | latest | |
| ngrok | latest | exposes local routes to ElevenLabs during development |

## Hosted services

| Service | Plan or tier | Used for |
| --- | --- | --- |
| Vercel | Hobby or Pro | Next.js; routes that start agent runs set `maxDuration = 300` |
| Railway | always on | FastAPI |
| Supabase | Free or Pro | Postgres, Auth (magic links; anonymous sign-ins off), Realtime, Storage (`trip-photos`, private) |
| Stripe | test mode | holds, captures, refunds |
| ElevenLabs Agents | account with calling | voice agent and server tool |
| Twilio | **upgraded** (no trial notice) | phone number, imported into ElevenLabs |
| Meta Model API | API key (`META_MODEL_API_KEY`) | Muse Spark, speech to text, SAM, Muse Image, search grounding |
| Google AI Studio | free | Gemini Flash fallback |
| Google Places, OpenRouteService | API keys | venues, routing |
| Sentry | free | errors |

## Meta Model API (verified 2026-09-25)

Source: dev.meta.ai/docs (developer.meta.com/ai redirects there). Bearer auth with `META_MODEL_API_KEY` (Meta's docs call it `MODEL_API_KEY`).

| Use | Model ID | Endpoint | Env var (default) | Price on 2026-09-25 |
| --- | --- | --- | --- | --- |
| Agent planning, tool calling, photo captions, best-shot scoring | `muse-spark-1.3` | `POST /v1/chat/completions` | `AGENT_MODEL`, `VISION_MODEL` | $1.25 input, $0.15 cached, $4.25 output per 1M tokens |
| Voice notes | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` (multipart; WAV 16-bit PCM mono, 16 or 24 kHz; ≤ 10 min, ≤ 32 MB) | `TRANSCRIBE_MODEL` | $0.18 per audio hour |
| Subject segmentation | `sam-3.1` | `POST /v1/responses` | `SEGMENT_MODEL` | $2.50 per 1,000 images |
| Recap cover | `muse-image-1.0` | `POST /v1/images/generations`, `/v1/images/edits` | `IMAGE_MODEL` | $0.01 per image |
| Search grounding | `muse-spark-1.3` with the `web_search` tool | `POST /v1/responses` only | `GROUNDING_MODEL` | $2.50 per 1,000 searches, plus tokens |

- Base URL `https://api.meta.ai/v1` (`META_MODEL_API_BASE_URL`). Standard tier: 3,000 requests and 4M tokens per minute; Muse Image, 150 requests per minute.
- `tool_choice` accepts only `"auto"`. Structured output: `response_format` JSON schema (Chat Completions) or `text.format` (Responses); strict mode rejects `oneOf` and `allOf`.
- Images in: JPEG, PNG, GIF, WebP; up to 50 per request, 50 MB each, in user messages only.
- Also listed: `muse-spark-1.2`, `muse-spark-1.1`, contributor-tier variants, and `muse-glimmer` (open weights, self-hosted; not used).
