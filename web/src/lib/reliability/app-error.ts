import type { ApiErrorBody, ApiErrorCode, ToolError, ToolErrorCode } from "@agp/shared";

export type AppErrorCode = ApiErrorCode | ToolErrorCode;

const HTTP_STATUS: Record<AppErrorCode, number> = {
  invalid_input: 400,
  unknown_handle: 400,
  unauthenticated: 401,
  not_permitted: 403,
  not_found: 404,
  conflict: 409,
  domain_rule: 422,
  internal: 500,
  provider_unavailable: 502,
  timeout: 504,
};

// Codes the HTTP layer has but the model's ToolError doesn't.
const TOOL_CODE: Partial<Record<AppErrorCode, ToolErrorCode>> = {
  unauthenticated: "not_permitted",
  not_found: "invalid_input",
  domain_rule: "conflict",
};

const GENERIC_MESSAGE = "Something went wrong.";

/**
 * The one error type the app throws on purpose. Its message is safe to show; anything else is
 * treated as unexpected and shown as a generic message.
 */
export class AppError extends Error {
  override readonly name = "AppError";
  readonly retryable: boolean;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.retryable = options.retryable ?? (code === "provider_unavailable" || code === "timeout");
  }
}

/** The HTTP status and `{ error: { code, message, retryable } }` body for any thrown value. */
export function toHttpError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof AppError) {
    const code = error.code === "unknown_handle" ? "invalid_input" : error.code;
    return {
      status: HTTP_STATUS[error.code],
      body: { error: { code, message: error.message, retryable: error.retryable } },
    };
  }
  return { status: 500, body: { error: { code: "internal", message: GENERIC_MESSAGE, retryable: true } } };
}

/** The ToolError the model sees for any thrown value. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof AppError) {
    const code = TOOL_CODE[error.code] ?? (error.code as ToolErrorCode);
    return { code, message: error.message, retryable: error.retryable };
  }
  return { code: "internal", message: GENERIC_MESSAGE, retryable: true };
}
