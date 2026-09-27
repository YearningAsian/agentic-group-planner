"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { itineraryShareUrl, randomShareCode } from "./share-link";
import { useTrip } from "./trip-context";

/** Stable share URL for the current trip. Minted the first time a summary is shown. */
export function useItineraryShareLink(): { url: string; code: string } {
  const trip = useTrip();
  const { shareCode } = trip.state;
  const setShareCode = trip.setShareCode;
  const [minted] = useState(() => shareCode || randomShareCode());
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  useEffect(() => {
    if (!shareCode) setShareCode(minted);
  }, [minted, shareCode, setShareCode]);

  const code = shareCode || minted;
  return { url: itineraryShareUrl(origin, code), code };
}
