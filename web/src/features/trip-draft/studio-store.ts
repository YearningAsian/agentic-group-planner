/** In-memory copy of the shared trips plus this user's profile. The browser pushes it to `/api/studio-state`. */

import { getBrowserClient } from "@/lib/supabase/browser";
import { bindStudioBoard } from "./studio-live";

export type StudioProfile = {
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
};

export type StudioDocument = {
  activeTripId: string | null;
  trips: unknown[];
  profile: StudioProfile;
};

const emptyProfile = (): StudioProfile => ({ homeAddress: "", homeLat: null, homeLng: null });

let current: StudioDocument = { activeTripId: null, trips: [], profile: emptyProfile() };

export function readStudio(): StudioDocument {
  return current;
}

/** Clears or replaces the document. Tests use this; the app does not keep a browser copy on disk. */
export function resetStudioMemory(next?: Partial<StudioDocument>): void {
  current = {
    activeTripId: next?.activeTripId ?? null,
    trips: next?.trips ?? [],
    profile: next?.profile ?? emptyProfile(),
  };
}

export function writeStudioTrips(activeTripId: string | null, trips: unknown[]): void {
  current = { ...current, activeTripId, trips };
  void pushStudio();
}

export function writeStudioProfile(profile: StudioProfile): void {
  current = { ...current, profile };
  void pushStudio();
}

/** Loads the signed-in user's document. A missing session leaves memory unchanged. */
export async function pullStudio(): Promise<void> {
  if (typeof window === "undefined" || process.env.VITEST) return;
  const response = await fetch("/api/studio-state");
  if (!response.ok) return;
  const body = (await response.json()) as Partial<StudioDocument>;
  current = {
    activeTripId: typeof body.activeTripId === "string" ? body.activeTripId : null,
    trips: Array.isArray(body.trips) ? body.trips : [],
    profile: {
      homeAddress: typeof body.profile?.homeAddress === "string" ? body.profile.homeAddress : "",
      homeLat: typeof body.profile?.homeLat === "number" ? body.profile.homeLat : null,
      homeLng: typeof body.profile?.homeLng === "number" ? body.profile.homeLng : null,
    },
  };
}

async function pushStudio(): Promise<void> {
  if (typeof window === "undefined" || process.env.VITEST) return;
  const response = await fetch("/api/studio-state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(current),
  });
  if (!response.ok) {
    console.error("Couldn't save trips", response.status);
  }
}

/** Refetches the document when the shared board changes. The event payload is ignored. */
export function subscribeStudio(onPulled: () => void): () => void {
  if (typeof window === "undefined" || process.env.VITEST) return () => undefined;
  const channel = getBrowserClient().channel("studio-board");
  return bindStudioBoard(
    (handler) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studio_board" },
        () => handler(),
      );
      void channel.subscribe();
      return () => {
        void getBrowserClient().removeChannel(channel);
      };
    },
    pullStudio,
    onPulled,
  );
}
