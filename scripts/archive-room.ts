/**
 * Runs one archive pass for a single approved room: reads messages after
 * the stored cursor and inserts them into the local SQLite database.
 *
 * Usage: npm run archive:room -- --room gsg-validation
 */
import { loadConfig } from "../src/config/env.js";
import { buildAdapterContext } from "../src/context.js";
import { assertAllowedRoom } from "../src/security/room-policy.js";
import { parseArgs } from "./arg-parser.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const room = flags.room;
  if (!room) fail("--room <name> is required.");

  const config = loadConfig();
  assertAllowedRoom(room, config.allowedRooms);

  const ctx = buildAdapterContext(config);
  const result = await ctx.archive.archiveRoom(room);

  console.log(JSON.stringify(result, null, 2));
  if (result.gapDetected) {
    console.warn(
      "Warning: a cursor gap was detected — the upstream ring buffer likely rotated past the " +
        "last archived sequence. Some messages between the old cursor and the new window were lost.",
    );
  }

  ctx.db.close();
}

main().catch((err) => fail((err as Error).message));
