export type { BranchPoint, LaneMember, LegView, MergePoint, SlotView, StopView, TripView } from "./types";
export { checkTripView } from "./check";
export { bookedFixture, noAreaFixture, votingFixture } from "./fixtures";

/** Declared for the plan and map pages. FE-218 fills this in from database rows. */
export function useTripView(_tripId: string): { status: "loading" } {
  return { status: "loading" };
}
