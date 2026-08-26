import { Router } from "express";
import type { AdapterContext } from "../context.js";
import { asyncRoute } from "./errors.js";

export function healthRouter(ctx: AdapterContext): Router {
  const router = Router();

  // Public health response: no secret configuration, DB details, or identity locations.
  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      res.json({
        success: true,
        data: {
          status: "ok",
          nodeEnv: ctx.config.nodeEnv,
          approvedRoomCount: ctx.config.allowedRooms.length,
          publishingEnabled: ctx.publishService !== null,
        },
      });
    }),
  );

  router.get(
    "/upstream",
    asyncRoute(async (_req, res) => {
      const start = Date.now();
      const probeRoom = ctx.config.allowedRooms[0];
      if (!probeRoom) {
        res.json({ success: true, data: { status: "unknown", reason: "no allowed rooms configured" } });
        return;
      }
      try {
        await ctx.technocore.readRoom(probeRoom, { limit: 1 });
        res.json({ success: true, data: { status: "ok", latencyMs: Date.now() - start } });
      } catch {
        res.json({ success: true, data: { status: "degraded", latencyMs: Date.now() - start } });
      }
    }),
  );

  return router;
}
