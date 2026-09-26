import { AppError } from "@/lib/reliability";
import type { PlannerResponse, PlanRequest } from "./client";

function drifted(detail: string): AppError {
  // Retrying sends the same request to the same service, so it would fail the same way.
  return new AppError("internal", `The planner's answer doesn't match the request: ${detail}.`, { retryable: false });
}

/**
 * Checks that an answer only uses what the request offered: every option and assignment is one of
 * its slot's candidates, and every member is one of the request's. Prices come only from the
 * request's candidates, so an option outside them would have no price; a drifted optimizer is an
 * `internal` error rather than a plan with an invented $0.
 */
export function checkPlanResponse(request: PlanRequest, response: PlannerResponse): void {
  const candidates = new Map(request.slots.map((s) => [s.key, new Set(s.candidates.map((c) => c.place_id))]));
  const members = new Set(request.members.map((m) => m.id));
  const checkGroup = (slotKey: string, placeIds: string[], memberIds: string[]) => {
    const offered = candidates.get(slotKey);
    if (!offered) throw drifted(`there's no ${slotKey} slot`);
    const stray = placeIds.find((id) => !offered.has(id));
    if (stray) throw drifted(`place ${stray} isn't a ${slotKey} candidate`);
    if (memberIds.length === 0 || memberIds.some((id) => !members.has(id))) throw drifted(`a ${slotKey} group has an unknown member`);
  };
  for (const plan of response.plans) {
    for (const slot of plan.assignments) for (const group of slot.groups) checkGroup(slot.slot_key, [group.place_id], group.member_ids);
  }
  for (const slot of response.slot_options) {
    for (const group of slot.groups) {
      if (group.options.length === 0) throw drifted(`a ${slot.slot_key} group has no options`);
      checkGroup(slot.slot_key, group.options.map((o) => o.place_id), group.member_ids);
    }
  }
  if (response.plans.length > 0) {
    const missing = request.slots.find((s) => !s.pinned && !response.slot_options.some((o) => o.slot_key === s.key));
    if (missing) throw drifted(`there are no options for ${missing.key}`);
  }
}
