/**
 * Example: publish a signed message to Technocore through the full
 * adapter pipeline (policy gate, nonce allocation, signing, archiving).
 * Requires an agent identity already created with `npm run identity:create`
 * and activated via PATCH /api/technocore/agents/:slug/status.
 *
 * Run with:
 *   npx tsx examples/publish-signed-message.ts <agentSlug> <room> "<text>"
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config/env.js";
import { buildAdapterContext } from "../src/context.js";

async function main(): Promise<void> {
  const [agentSlug, room, text] = process.argv.slice(2);
  if (!agentSlug || !room || !text) {
    console.error('Usage: npx tsx examples/publish-signed-message.ts <agentSlug> <room> "<text>"');
    process.exit(1);
  }

  const config = loadConfig();
  const ctx = buildAdapterContext(config);
  if (!ctx.publishService) {
    console.error("Publishing is not available: TECHNOCORE_IDENTITY_ENCRYPTION_KEY is not set.");
    process.exit(1);
  }

  const result = await ctx.publishService.publish({
    agentSlug,
    room,
    text,
    idempotencyKey: randomUUID(),
  });

  console.log(JSON.stringify(result, null, 2));
  ctx.db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
