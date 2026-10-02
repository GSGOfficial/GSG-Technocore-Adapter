import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { unauthorizedError } from "../client/technocore-errors.js";
import type { AdapterConfig } from "../config/env.js";

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * MVP scoped-credential check: a single bearer token configured via
 * GSG_TECHNOCORE_API_KEY. This is intentionally a placeholder for the
 * existing api.gsgnft.com authentication mechanism (build plan section 12
 * says to use it if one exists) — swap this middleware for that host's
 * real per-client scoped-key lookup before production use with multiple
 * GSG clients.
 */
export function requireGsgAuth(config: AdapterConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!config.gsgApiKey) {
      next(unauthorizedError("This deployment has no GSG_TECHNOCORE_API_KEY configured."));
      return;
    }
    if (!isAuthorized(req, config.gsgApiKey)) {
      // Never log the presented credential.
      console.warn(
        JSON.stringify({
          event: "technocore_auth_rejected",
          method: req.method,
          path: req.originalUrl.split("?")[0],
          requestId: (req as Request & { requestId?: string }).requestId,
        }),
      );
      next(unauthorizedError("Missing or invalid Authorization bearer credential."));
      return;
    }
    next();
  };
}

export function isAuthorized(req: { header(name: string): string | undefined }, apiKey: string): boolean {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && !!token && constantTimeEquals(token, apiKey);
}
