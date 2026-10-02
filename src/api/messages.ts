import { Router } from "express";
import { z } from "zod";
import type { AdapterContext } from "../context.js";
import { asyncRoute } from "./errors.js";
import { assertAllowedRoom } from "../security/room-policy.js";
import { invalidMessageError, unauthorizedError, archiveError } from "../client/technocore-errors.js";
import { isAuthorized, requireGsgAuth } from "./auth.js";
import { requireParam } from "./params.js";

const listQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  refresh: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const publishBodySchema = z.object({
  agentSlug: z.string().min(1),
  text: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export function messagesRouter(ctx: AdapterContext): Router {
  const router = Router();

  // GET /api/technocore/rooms/:room/messages?since=&limit=&refresh=
  // Prefers archived local results; an authorized caller may pass
  // refresh=true to trigger a fresh upstream archive pass first.
  router.get(
    "/:room/messages",
    asyncRoute(async (req, res, next) => {
      const room = requireParam(req.params, "room");
      try {
        assertAllowedRoom(room, ctx.config.allowedRooms);
      } catch (err) {
        next(err);
        return;
      }
      const query = listQuerySchema.parse(req.query);

      if (query.refresh) {
        if (!ctx.config.gsgApiKey || !isAuthorized(req, ctx.config.gsgApiKey)) {
          next(unauthorizedError("refresh=true requires a valid GSG bearer credential."));
          return;
        }
        await ctx.archive.archiveRoom(room);
      }

      try {
        const rows = ctx.db
          .prepare(
            `SELECT sequence_number, source_timestamp, message_text, public_did, nickname, is_signed
             FROM technocore_messages
             WHERE room = ? AND sequence_number > ?
             ORDER BY sequence_number ASC
             LIMIT ?`,
          )
          .all(room, query.since, query.limit);
        res.json({ success: true, data: { room, messages: rows, source: "archive" } });
      } catch (err) {
        next(archiveError(`Failed to read archived messages: ${(err as Error).message}`));
      }
    }),
  );

  // POST /api/technocore/rooms/:room/messages — signed publish.
  router.post(
    "/:room/messages",
    requireGsgAuth(ctx.config),
    asyncRoute(async (req, res, next) => {
      const room = requireParam(req.params, "room");
      try {
        assertAllowedRoom(room, ctx.config.allowedRooms);
      } catch (err) {
        next(err);
        return;
      }

      const idempotencyKey = req.header("idempotency-key");
      if (!idempotencyKey) {
        next(invalidMessageError("Idempotency-Key header is required for publishing."));
        return;
      }

      const body = publishBodySchema.parse(req.body);

      if (!ctx.publishService) {
        next(
          archiveError(
            "Publishing is not available: TECHNOCORE_IDENTITY_ENCRYPTION_KEY is not configured.",
          ),
        );
        return;
      }

      const result = await ctx.publishService.publish({
        agentSlug: body.agentSlug,
        room,
        text: body.text,
        idempotencyKey,
        metadata: body.metadata,
        requestId: (req as typeof req & { requestId?: string }).requestId,
      });

      res.json({ success: true, data: result });
    }),
  );

  return router;
}
