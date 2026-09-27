import { SEEDED_USERS, seededEmail } from "../fixtures/users";

export interface BatchUser {
  id: string;
  email: string | null;
  seed_batch: string | null;
}

export interface ResetPlan {
  /** Every trip-scoped row of the batch cascades from its trips. */
  deleteTripsOfBatch: string;
  deleteUserIds: string[];
  deleteSeedPlaces: boolean;
  deleteRoutesOfSeedPlaces: boolean;
  /** Storage objects live under `{batch}/`; nothing stores objects since the pivot, but --all clears it. */
  deleteStoragePrefix: string | null;
  /** The seed:demo steps to run afterwards (design §10.4). */
  reseedSteps: number[];
}

/**
 * What `reset:demo` deletes (design §10.5). A plain reset removes the batch's trips and the users who
 * claimed a lane in it, and keeps the seeded users (so they stay signed in), places, and routes.
 * `--all` removes those too. Other batches and users without a batch are never touched.
 */
export function resetPlan(input: { batch: string; all: boolean; users: BatchUser[] }): ResetPlan {
  const seeded = new Set(SEEDED_USERS.map((u) => seededEmail(u.key, input.batch)));
  const ofBatch = input.users.filter((u) => u.seed_batch === input.batch);
  const deleteUserIds = ofBatch.filter((u) => input.all || !u.email || !seeded.has(u.email)).map((u) => u.id);
  return {
    deleteTripsOfBatch: input.batch,
    deleteUserIds,
    deleteSeedPlaces: input.all,
    deleteRoutesOfSeedPlaces: input.all,
    deleteStoragePrefix: input.all ? `${input.batch}/` : null,
    reseedSteps: input.all ? [1, 3, 4, 5, 6] : [4, 5, 6],
  };
}
