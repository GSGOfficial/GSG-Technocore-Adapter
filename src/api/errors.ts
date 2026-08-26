import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { isTechnocoreError, TechnocoreError } from "../client/technocore-errors.js";

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    retryAfterSeconds?: number;
  };
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  (req as Request & { requestId: string }).requestId = randomUUID();
  next();
}

export function sendError(req: Request, res: Response, err: TechnocoreError): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? randomUUID();
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    },
  };
  if (err.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(err.retryAfterSeconds));
  }
  res.status(err.httpStatus).json(body);
}

/** Express error-handling middleware. Never leaks upstream stack traces or secrets. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (isTechnocoreError(err)) {
    sendError(req, res, err);
    return;
  }
  console.error(
    JSON.stringify({
      event: "unhandled_api_error",
      requestId: (req as Request & { requestId?: string }).requestId,
      message: err instanceof Error ? err.message : "unknown error",
    }),
  );
  sendError(
    req,
    res,
    new TechnocoreError("TECHNOCORE_UPSTREAM_ERROR", "An unexpected error occurred.", { httpStatus: 500 }),
  );
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
