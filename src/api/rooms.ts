import { Router } from "express";
import type { AdapterContext } from "../context.js";
import { asyncRoute } from "./errors.js";

export function roomsRouter(ctx: AdapterContext): Router {
  const router = Router();

  // GET /api/technocore/rooms — GSG-approved rooms + cursor/health metadata only.
  // Never proxies the full untrusted upstream room directory.
  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      const rooms = await Promise.all(
        ctx.config.allowedRooms.map(async (room) => ({
          room,
          archivedThroughSequence: await ctx.cursors.getCursor(room),
        })),
      );
      res.json({ success: true, data: { rooms } });
    }),
  );

  return router;
}
