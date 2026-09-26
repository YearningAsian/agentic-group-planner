/** Whether a Mapbox publishable token looks real enough to call the Maps/Geocoding APIs. */
export function isLiveMapboxToken(token: string | undefined): token is string {
  if (!token) return false;
  if (!token.startsWith("pk.")) return false;
  if (token.includes("placeholder") || token.includes("dummy")) return false;
  return token.length > 40;
}
