import { Router } from "express";
import { z } from "zod";
import type { AdapterContext } from "../context.js";
import { asyncRoute } from "./errors.js";
import { requireGsgAuth } from "./auth.js";
import { requireParam } from "./params.js";

const statusBodySchema = z.object({
  status: z.enum(["active", "paused", "revoked"]),
});

export function agentsRouter(ctx: AdapterContext): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      const agents = await ctx.agents.listAgents();
      res.json({ success: true, data: { agents } });
    }),
  );

  router.get(
    "/:slug",
    asyncRoute(async (req, res) => {
      const agent = await ctx.agents.getAgent(requireParam(req.params, "slug"));
      res.json({ success: true, data: agent });
    }),
  );

  // Only administrators may activate, pause, or revoke an agent.
  router.patch(
    "/:slug/status",
    requireGsgAuth(ctx.config),
    asyncRoute(async (req, res) => {
      const body = statusBodySchema.parse(req.body);
      const agent = await ctx.agents.setStatus(requireParam(req.params, "slug"), body.status);
      res.json({ success: true, data: agent });
    }),
  );

  return router;
}
