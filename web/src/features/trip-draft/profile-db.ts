/**
 * Local profile (home address) for the trip-draft prototype. Separate from the trips database.
 */
export const PROFILE_KEY = "agp-profile";

export type LocalProfile = {
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
};

const empty: LocalProfile = { homeAddress: "", homeLat: null, homeLng: null };

export function loadProfile(): LocalProfile {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return empty;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<LocalProfile>;
    return {
      homeAddress: typeof parsed.homeAddress === "string" ? parsed.homeAddress : "",
      homeLat: typeof parsed.homeLat === "number" ? parsed.homeLat : null,
      homeLng: typeof parsed.homeLng === "number" ? parsed.homeLng : null,
    };
  } catch {
    return empty;
  }
}

export function saveProfile(profile: LocalProfile): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage quota or blocked in private mode
  }
}
