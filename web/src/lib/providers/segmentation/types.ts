export type SegmentationProviderName = "real" | "mock";

/** A box in image coordinates, normalized to 0–1 so it survives resizing. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentMatch {
  box: NormalizedBox;
  /** The model's confidence, 0–1. */
  score: number;
}

export interface SegmentationProvider {
  readonly name: SegmentationProviderName;
  /**
   * Finds every match for a noun phrase ("person", "dog") in one photo, through SAM on the
   * Responses API. Best-shot picking scores the subject's size and placement; recap crops keep it.
   */
  segment(input: { imageUrl: string; prompt: string }): Promise<SegmentMatch[]>;
}
