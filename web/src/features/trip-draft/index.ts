// Client-safe entry point. App routes and other features import trip-draft only through here.
export { TripProvider, useTrip } from "./trip-context";
export type { Member, TripState } from "./trip-context";

export { DashboardHome } from "./components/dashboard-home";
export { ItineraryView } from "./components/itinerary-view";
export { OnboardingEntry } from "./components/onboarding-entry";
export { PlanPicker } from "./components/plan-picker";
export { PlannerStudio } from "./components/planner-studio";
export { ProgressGraph } from "./components/progress-graph";
export { StayListing } from "./components/stay-listing";
export { TripSummary } from "./components/trip-summary";
export { TripsBoard } from "./components/trips-board";

export { destinationById } from "./fixtures";
export { formatRange, nightsBetween, validRange } from "./format";
