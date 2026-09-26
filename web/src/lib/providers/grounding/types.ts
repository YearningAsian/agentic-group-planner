export type GroundingProviderName = "real" | "mock";

/** A source the model cited: a Responses API `url_citation` annotation on `answerText`. */
export interface Citation {
  url: string;
  title: string;
  /** Offsets into `answerText`, so the UI can show which claim each source backs. */
  startIndex: number;
  endIndex: number;
}

/** What the web says about a venue's hours and prices, stored with the sources behind it. */
export interface VenueFacts {
  /** As the source states them, like "Daily 9 AM–9 PM"; null when the model found nothing. */
  hours: string | null;
  priceNote: string | null;
  answerText: string;
  citations: Citation[];
  model: string;
  checkedAt: string;
}

/**
 * Search grounding (the `web_search` tool, Responses API only). Only the places adapter calls it,
 * so the rest of the app asks `PlacesProvider.groundFacts` and never sees this interface.
 */
export interface GroundingProvider {
  readonly name: GroundingProviderName;
  venueFacts(input: { name: string; address: string | null; city: string }): Promise<VenueFacts>;
}
