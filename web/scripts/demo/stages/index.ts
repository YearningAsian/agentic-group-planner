/**
 * Seed stages fast-forward the Saturday trip (design §10.3), so each workstream can build its flow
 * without waiting on the others. Each stage lives in its own file, owned by the workstream whose
 * code it calls: planned (AI-214), discussed (FE-222), booked (CO-214).
 */
import type { ScriptAdmin } from "../lib/admin";
import { STAGES, type Stage } from "../lib/args";
import { runBooked } from "./booked";
import { runDiscussed } from "./discussed";
import { runPlanned } from "./planned";

export interface StageContext {
  admin: ScriptAdmin;
  batch: string;
  tripId: string;
}

const RUNNERS: Record<Stage, (ctx: StageContext) => Promise<void>> = {
  planned: runPlanned,
  discussed: runDiscussed,
  booked: runBooked,
};

/** Every stage up to and including the one requested, in order: booked needs discussed needs planned. */
export function stagesUpTo(stage: Stage | undefined): Stage[] {
  return stage ? STAGES.slice(0, STAGES.indexOf(stage) + 1) : [];
}

export async function runStages(ctx: StageContext, stage: Stage | undefined): Promise<void> {
  for (const name of stagesUpTo(stage)) await RUNNERS[name](ctx);
}
