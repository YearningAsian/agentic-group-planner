export type ImageProviderName = "real" | "mock";

export interface GeneratedImage {
  bytes: Uint8Array;
  format: "webp" | "png" | "jpeg";
}

export interface ImageProvider {
  readonly name: ImageProviderName;
  /**
   * One image from a prompt, optionally composed from reference photos (POST /v1/images/edits
   * when references are given, /v1/images/generations otherwise). Used for the recap cover.
   */
  generate(input: { prompt: string; size: `${number}x${number}`; referenceImageUrls?: string[] }): Promise<GeneratedImage>;
}
