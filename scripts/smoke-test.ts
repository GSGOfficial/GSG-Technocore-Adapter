/**
 * Opt-in live smoke test against the real technocore.chat service.
 *
 * Read-only by default (safe, non-destructive):
 *   npm run smoke-test -- --room gsg-validation
 *
 * Read-only smoke tests never touch the public `lobby` room and never
 * write. Live writes are NOT implemented in this script — publishing a
 * real signed message under a GSG production DID is a visible, external
 * action and should go through the reviewed `PublishService` / API route
 * with explicit human approval, not an unattended CLI smoke test.
 */
import { loadConfig } from "../src/config/env.js";
import { TechnocoreClient, clientOptionsFromConfig } from "../src/client/technocore-client.js";
import { assertAllowedRoom } from "../src/security/room-policy.js";
import { parseArgs } from "./arg-parser.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const room = flags.room;
  if (!room) fail("--room <name> is required (must be in GSG_ALLOWED_ROOMS).");
  if (room === "lobby") fail("Refusing to run smoke tests against the public lobby room.");

  const config = loadConfig();
  assertAllowedRoom(room, config.allowedRooms);

  const client = new TechnocoreClient(clientOptionsFromConfig(config));

  console.log(`Reading room "${room}" from ${config.technocoreBaseUrl} ...`);
  const start = Date.now();
  const result = await client.readRoom(room, { limit: 5 });
  const latencyMs = Date.now() - start;

  console.log(`OK — ${latencyMs}ms, last_sequence=${result.lastSequence}, ${result.messages.length} message(s):`);
  for (const m of result.messages) {
    console.log(`  [${m.sequence}] ${m.signed ? m.did : m.nickname}: ${m.text}`);
  }
}

main().catch((err) => fail((err as Error).message));
