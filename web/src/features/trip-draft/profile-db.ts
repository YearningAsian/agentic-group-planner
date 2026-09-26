/**
 * Home address for the studio, stored on the signed-in user's `studio_state` row.
 */
import { readStudio, writeStudioProfile, type StudioProfile } from "./studio-store";

export type LocalProfile = StudioProfile;

export function loadProfile(): LocalProfile {
  return readStudio().profile;
}

export function saveProfile(profile: LocalProfile): void {
  writeStudioProfile(profile);
}
