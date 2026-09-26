# Split-view shell (scope B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Questionnaire-vs-Chat entry choice at `/onboarding` and make studio chat drive the live map, reusing the existing trip-draft prototype instead of building a parallel shell.

**Architecture:** Three surgical additions only: a presentational entry-choice component, a search-param host that reuses `OnboardingFlow` as-is, and a pure city-detect helper in `fixtures.ts` wired into `PlannerStudio.send()`. No frozen barrels, no migrations, no new routes. The questionnaire split view (`OnboardingFlow` + `TripMap`), the chat split view (`PlannerStudio` + `TripMap`), and fly-to + single pin (`MapLibreCanvas`) already exist and are not rebuilt.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest (`unit` node + `unit-dom` jsdom projects), Testing Library, Tailwind tokens.

---

## File structure

| File | Responsibility |
| --- | --- |
| Create: `web/src/features/trip-draft/components/entry-choice.tsx` | Presentational two-option entry (Questionnaire link, Chat link). No router calls, plain `Link`s, 44px targets. |
| Create: `web/src/features/trip-draft/components/entry-choice.test.tsx` | jsdom test: both options render with correct hrefs. |
| Create: `web/src/features/trip-draft/components/onboarding-entry.tsx` | Client host: reads `?entry=` via `useSearchParams`; `questions` renders `OnboardingFlow`, otherwise `EntryChoice`. |
| Create: `web/src/features/trip-draft/components/onboarding-entry.test.tsx` | jsdom test with `next/navigation` and `onboarding-flow` mocked: default renders choice, `?entry=questions` renders flow. |
| Modify: `web/src/app/(trip-draft)/onboarding/page.tsx` | Render `OnboardingEntry` inside `Suspense` instead of `OnboardingFlow` directly. |
| Modify: `web/src/features/trip-draft/fixtures.ts` | Append pure helper `chatCityDestination(text, currentId)` (wraps `matchDestination`, returns null when no match or already selected). |
| Create: `web/src/features/trip-draft/fixtures.test.ts` | Node unit test for the helper (match, same-city null, unknown null, case/whitespace tolerant). |
| Modify: `web/src/features/trip-draft/components/planner-studio.tsx` | `send()` uses the helper: on a new city, `confirmDestination` + map-moved reply; otherwise existing `agentReply`. |

Deviation from the spec (deliberate, surgical): the spec named new files `question-step.tsx`, `chat-mock.tsx`, `mock-trip-view.ts`. Exploration showed `OnboardingFlow` already is the stepped mock (6 steps, progressbar, Skip on optional steps, per-step tips, validation), `PlannerStudio` already is the local-echo chat, `TripProvider` already holds destination/dates/`pinDropped`, and `MapLibreCanvas` already flies + pins. Building parallel files would duplicate working code, so this plan wires the gaps instead.

---

### Task 1: Entry choice component

**Files:**
- Create: `web/src/features/trip-draft/components/entry-choice.tsx`
- Test: `web/src/features/trip-draft/components/entry-choice.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntryChoice } from "./entry-choice";

describe("EntryChoice", () => {
  it("offers Questionnaire and Chat as two clear options", () => {
    render(<EntryChoice />);
    const questions = screen.getByRole("link", { name: /questionnaire/i });
    const chat = screen.getByRole("link", { name: /chat/i });
    expect(questions).toHaveAttribute("href", "/onboarding?entry=questions");
    expect(chat).toHaveAttribute("href", "/studio");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- src/features/trip-draft/components/entry-choice.test.tsx`
Expected: FAIL with "Cannot find module './entry-choice'".

- [ ] **Step 3: Write minimal implementation**

```tsx
import Link from "next/link";

const linkClass =
  "flex min-h-11 items-center gap-3 rounded-2xl px-4 py-3 ring-1 ring-line hover:ring-ink";

/** First screen of a new trip: two clear options, not a buried toggle. */
export function EntryChoice() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-5 py-6">
      <p className="text-[13px] font-semibold text-muted">Group Trip Agent</p>
      <h1 className="mt-2 text-[32px] font-semibold tracking-tight text-balance">Start a new trip</h1>
      <p className="mt-2 text-[15px] text-muted">Answer a few questions, or just chat. Both open the live map.</p>
      <div className="mt-6 flex flex-col gap-3">
        <Link href="/onboarding?entry=questions" className={linkClass}>
          <span aria-hidden>📋</span>
          <span>
            <span className="block text-[16px] font-semibold">Questionnaire</span>
            <span className="block text-[14px] text-muted">One question at a time, about 2 minutes</span>
          </span>
        </Link>
        <Link href="/studio" className={linkClass}>
          <span aria-hidden>💬</span>
          <span>
            <span className="block text-[16px] font-semibold">Chat</span>
            <span className="block text-[14px] text-muted">Describe the trip in your own words</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- src/features/trip-draft/components/entry-choice.test.tsx`
Expected: PASS (1 passed).

- [ ] **Step 5: Verify, leave uncommitted**

Run: `pnpm --filter web typecheck`
Expected: exit 0. Do not commit (owner handles version control).

---

### Task 2: Onboarding entry host + page wiring

**Files:**
- Create: `web/src/features/trip-draft/components/onboarding-entry.tsx`
- Test: `web/src/features/trip-draft/components/onboarding-entry.test.tsx`
- Modify: `web/src/app/(trip-draft)/onboarding/page.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingEntry } from "./onboarding-entry";

let mockedEntry: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => (key === "entry" ? mockedEntry : null) }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/trip-draft/components/onboarding-flow", () => ({
  OnboardingFlow: () => <p>mock questionnaire flow</p>,
}));

describe("OnboardingEntry", () => {
  it("shows the two-option choice by default", () => {
    mockedEntry = null;
    render(<OnboardingEntry />);
    expect(screen.getByRole("link", { name: /questionnaire/i })).toBeInTheDocument();
    expect(screen.queryByText("mock questionnaire flow")).not.toBeInTheDocument();
  });

  it("renders the questionnaire flow for ?entry=questions", () => {
    mockedEntry = "questions";
    render(<OnboardingEntry />);
    expect(screen.getByText("mock questionnaire flow")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- src/features/trip-draft/components/onboarding-entry.test.tsx`
Expected: FAIL with "Cannot find module './onboarding-entry'".

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { EntryChoice } from "@/features/trip-draft/components/entry-choice";
import { OnboardingFlow } from "@/features/trip-draft/components/onboarding-flow";

/** `/onboarding` host: choice first, questionnaire only after an explicit pick. */
export function OnboardingEntry() {
  const params = useSearchParams();
  if (params.get("entry") === "questions") return <OnboardingFlow />;
  return <EntryChoice />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- src/features/trip-draft/components/onboarding-entry.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Rewire the page (no new route, same URL)**

Replace `web/src/app/(trip-draft)/onboarding/page.tsx` with:

```tsx
import { Suspense } from "react";
import type { Metadata } from "next";
import { OnboardingEntry } from "@/features/trip-draft/components/onboarding-entry";

export const metadata: Metadata = { title: "Start a trip" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-surface" role="status"><span className="sr-only">Loading</span></div>}>
      <OnboardingEntry />
    </Suspense>
  );
}
```

Run: `pnpm --filter web test -- src/app/routes.test.ts`
Expected: PASS (the `?entry=` query is stripped by the route guard, `/onboarding` and `/studio` both exist).

- [ ] **Step 6: Verify, leave uncommitted**

Run: `pnpm --filter web typecheck`
Expected: exit 0. Do not commit (owner handles version control).

---

### Task 3: Chat city-detect drives the map

**Files:**
- Modify: `web/src/features/trip-draft/fixtures.ts` (append helper, touch nothing else)
- Test: `web/src/features/trip-draft/fixtures.test.ts`
- Modify: `web/src/features/trip-draft/components/planner-studio.tsx` (import + `send()` branch only)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { chatCityDestination } from "./fixtures";

describe("chatCityDestination", () => {
  it("matches a city name to a new destination", () => {
    expect(chatCityDestination("Lisbon", null)?.id).toBe("lisbon");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(chatCityDestination("  KYOTO ", null)?.id).toBe("kyoto");
  });

  it("returns null when the city is already selected", () => {
    expect(chatCityDestination("Lisbon", "lisbon")).toBeNull();
  });

  it("returns null for unknown text", () => {
    expect(chatCityDestination("show something quieter", "lisbon")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- src/features/trip-draft/fixtures.test.ts`
Expected: FAIL with "chatCityDestination is not exported" (or "does not provide an export").

- [ ] **Step 3: Write minimal implementation (append to fixtures.ts, after `findStay`)**

```ts
/**
 * Chat city-detect for the studio shell. Returns the matched destination when the
 * message names a new city, else null. Pure wrapper over matchDestination so the
 * studio can confirm it (which drops the map pin) without duplicating matching.
 */
export function chatCityDestination(text: string, currentId: string | null): Destination | null {
  const match = matchDestination(text);
  if (!match || match.id === currentId) return null;
  return match;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- src/features/trip-draft/fixtures.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Wire into `PlannerStudio.send()` (two-line branch, nothing else changes)**

In `web/src/features/trip-draft/components/planner-studio.tsx`, extend the existing fixtures import with the helper:

```ts
import { chatCityDestination, destinationById, findStay, staysFor, type StayOption } from "@/features/trip-draft/fixtures";
```

Replace the body of `send()` after the `push("user", trimmed)` line:

```ts
  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !destination || !featured) return;
    push("user", trimmed);
    const city = chatCityDestination(trimmed, state.destinationId);
    if (city) {
      trip.confirmDestination(city.id);
      push("agent", `Got it — flying the map to ${city.label}, ${city.country}. I'll keep planning around the stays already pinned.`);
    } else {
      push("agent", agentReply(trimmed, destination.label, featured.name));
    }
    setDraft("");
  }
```

No component test: `PlannerStudio` renders `TripMap` (dynamic MapLibre/Mapbox canvases), which is fragile under jsdom. Coverage comes from the helper test plus manual verification below.

- [ ] **Step 6: Verify, leave uncommitted**

Run: `pnpm --filter web typecheck`
Expected: exit 0. Do not commit (owner handles version control).

---

### Task 4: Gates + manual verification

- [ ] **Step 1: Run the gates in order**

Run: `pnpm --filter web typecheck`
Expected: exit 0.

Run: `pnpm --filter web lint`
Expected: exit 0 (no new warnings in touched files).

Run: `pnpm --filter web test -- src/features/trip-draft src/app/routes.test.ts`
Expected: all pass (entry-choice 1, onboarding-entry 2, fixtures 4, routes guard green).

- [ ] **Step 2: Manual browser check (`pnpm --filter web dev`)**

1. Open `/onboarding`: two clear options render (Questionnaire, Chat), no questionnaire visible yet.
2. Pick Questionnaire: stepped flow renders (progress bar, Skip on optional steps, tip box), typing "Lisbon" + Continue drops the pin and flies the right-side map.
3. Open `/studio`, type "Kyoto": agent replies about flying the map and the map flies to Kyoto with stay pins.
4. Mobile width: panels stack, options are at least 44px tall.

- [ ] **Step 3: Confirm scope boundaries**

Run: `git status --short`
Expected: only the 6 files above (3 created components/tests, fixtures helper + test, page, planner-studio). No changes to `packages/shared`, `lib/tools`, migrations, or picker/graph files.
