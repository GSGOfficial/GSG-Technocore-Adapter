import { Router } from "express";
import { z } from "zod";
import type { AdapterContext } from "../context.js";
import { asyncRoute } from "./errors.js";
import { requireGsgAuth } from "./auth.js";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  publicUrl: z.string().url(),
  repositoryUrl: z.string().url().optional(),
  commitHash: z.string().optional(),
  publicDid: z.string().min(1),
  room: z.string().optional(),
  sequenceNumber: z.number().int().optional(),
  evidence: z.record(z.unknown()).optional(),
  publishedAt: z.string().optional(),
});

export function contributionsRouter(ctx: AdapterContext): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      const contributions = await ctx.contributions.list();
      res.json({ success: true, data: { contributions } });
    }),
  );

  // Creation is administrator-only.
  router.post(
    "/",
    requireGsgAuth(ctx.config),
    asyncRoute(async (req, res) => {
      const body = createSchema.parse(req.body);
      const record = await ctx.contributions.create(body);
      res.status(201).json({ success: true, data: record });
    }),
  );

  return router;
}
