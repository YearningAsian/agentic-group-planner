export type VoiceProviderName = "real" | "mock";

export interface CallVariables {
  call_id: string;
  restaurant: string;
  party_size: number;
  preferred_time: string;
  earliest: string;
  latest: string;
  name: string;
  notes: string;
}

export interface VoiceEvent {
  id: string;
  type: "post_call_transcription" | "call_initiation_failure";
  conversationId: string;
  callId: string;
  durationS?: number;
  summary?: string;
  dataCollection?: { confirmed_time?: string; party_size?: number };
  failureReason?: string;
}

export interface VoiceProvider {
  readonly name: VoiceProviderName;
  /** Never retried, so a phone is never dialed twice. */
  startCall(input: { callId: string; toNumber: string; dynamicVariables: CallVariables }): Promise<{
    conversationId: string;
    providerCallSid?: string;
  }>;
  verifyToolRequest(headers: Headers): boolean;
  parseWebhook(input: { rawBody: string; signatureHeader: string }): VoiceEvent;
}
