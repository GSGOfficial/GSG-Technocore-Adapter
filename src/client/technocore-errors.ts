export type TechnocoreErrorCode =
  | "TECHNOCORE_CONFIGURATION_ERROR"
  | "TECHNOCORE_INVALID_ROOM"
  | "TECHNOCORE_INVALID_MESSAGE"
  | "TECHNOCORE_AGENT_NOT_FOUND"
  | "TECHNOCORE_AGENT_INACTIVE"
  | "TECHNOCORE_AGENT_FORBIDDEN"
  | "TECHNOCORE_IDENTITY_ERROR"
  | "TECHNOCORE_NONCE_ERROR"
  | "TECHNOCORE_RATE_LIMITED"
  | "TECHNOCORE_TIMEOUT"
  | "TECHNOCORE_UPSTREAM_ERROR"
  | "TECHNOCORE_ARCHIVE_ERROR"
  | "TECHNOCORE_IDEMPOTENCY_CONFLICT"
  | "TECHNOCORE_UNKNOWN_PUBLISH_RESULT"
  | "TECHNOCORE_UNAUTHORIZED";

/** Maps directly onto the section 20 API error envelope's `code` field. */
export class TechnocoreError extends Error {
  readonly code: TechnocoreErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: TechnocoreErrorCode,
    message: string,
    options: { httpStatus?: number; retryAfterSeconds?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "TechnocoreError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export function configurationError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_CONFIGURATION_ERROR", message, { httpStatus: 500 });
}

export function invalidRoomError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_INVALID_ROOM", message, { httpStatus: 400 });
}

export function invalidMessageError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_INVALID_MESSAGE", message, { httpStatus: 400 });
}

export function agentNotFoundError(slug: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_AGENT_NOT_FOUND", `Unknown agent: ${slug}`, {
    httpStatus: 404,
  });
}

export function agentInactiveError(slug: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_AGENT_INACTIVE", `Agent is not active: ${slug}`, {
    httpStatus: 403,
  });
}

export function agentForbiddenError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_AGENT_FORBIDDEN", message, { httpStatus: 403 });
}

export function identityError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_IDENTITY_ERROR", message, { httpStatus: 500 });
}

export function nonceError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_NONCE_ERROR", message, { httpStatus: 500 });
}

export function rateLimitedError(message: string, retryAfterSeconds?: number): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_RATE_LIMITED", message, {
    httpStatus: 429,
    retryAfterSeconds,
  });
}

export function timeoutError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_TIMEOUT", message, { httpStatus: 504 });
}

export function upstreamError(message: string, details?: Record<string, unknown>): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_UPSTREAM_ERROR", message, { httpStatus: 502, details });
}

export function archiveError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_ARCHIVE_ERROR", message, { httpStatus: 500 });
}

export function idempotencyConflictError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_IDEMPOTENCY_CONFLICT", message, { httpStatus: 409 });
}

export function unknownPublishResultError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_UNKNOWN_PUBLISH_RESULT", message, { httpStatus: 202 });
}

export function unauthorizedError(message: string): TechnocoreError {
  return new TechnocoreError("TECHNOCORE_UNAUTHORIZED", message, { httpStatus: 401 });
}

export function isTechnocoreError(err: unknown): err is TechnocoreError {
  return err instanceof TechnocoreError;
}
