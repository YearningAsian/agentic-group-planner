import "server-only";

// Server entry point for the chat feature.
export { mentionsAgent, type SendMessageInput, type SendMessageResult, sendMessage } from "./server/send-message";
