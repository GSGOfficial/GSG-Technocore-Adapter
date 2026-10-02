import express, { type Express } from "express";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config/env.js";
import { buildAdapterContext, type AdapterContext } from "./context.js";
import { requestIdMiddleware, errorHandler } from "./api/errors.js";
import { roomsRouter } from "./api/rooms.js";
import { messagesRouter } from "./api/messages.js";
import { agentsRouter } from "./api/agents.js";
import { contributionsRouter } from "./api/contributions.js";
import { healthRouter } from "./api/health.js";

export * from "./context.js";
export * from "./client/technocore-client.js";
export * from "./client/technocore-types.js";
export * from "./client/technocore-errors.js";
export * from "./config/env.js";

/**
 * Builds an Express router exposing all /api/technocore/* routes, ready to
 * be mounted into an existing host application (e.g. api.gsgnft.com) via
 * `app.use("/api/technocore", createTechnocoreApp(ctx))`.
 */
export function createTechnocoreRouter(ctx: AdapterContext): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));
  router.use(requestIdMiddleware);

  router.use("/rooms", roomsRouter(ctx));
  router.use("/rooms", messagesRouter(ctx));
  router.use("/agents", agentsRouter(ctx));
  router.use("/contributions", contributionsRouter(ctx));
  router.use("/health", healthRouter(ctx));

  router.use(errorHandler);
  return router;
}

/** Standalone Express app, for running this adapter as its own service. */
export function createStandaloneApp(ctx: AdapterContext): Express {
  const app = express();
  app.use("/api/technocore", createTechnocoreRouter(ctx));
  return app;
}

function main(): void {
  const config = loadConfig();
  const ctx = buildAdapterContext(config);
  const app = createStandaloneApp(ctx);
  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const bound = typeof address === "object" && address !== null ? address : null;
    console.log(
      JSON.stringify({
        event: "technocore_adapter_started",
        host: bound?.address ?? config.host,
        port: bound?.port ?? config.port,
        nodeEnv: config.nodeEnv,
        allowedRooms: config.allowedRooms,
        publishingEnabled: ctx.publishService !== null,
      }),
    );
  });
}

// Only auto-start when executed directly (`npm run dev` / `npm start`),
// not when imported as a library into a host application. Compared as
// file:// URLs (rather than raw string concatenation) so this also works
// when the path contains spaces or other characters that get percent-
// encoded in import.meta.url.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
