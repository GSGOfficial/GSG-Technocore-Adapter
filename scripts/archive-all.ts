/**
 * Runs one archive pass for every room in GSG_ALLOWED_ROOMS. Intended for
 * the gsg-technocore-archive systemd timer, so archiving does not depend on
 * someone calling `GET .../messages?refresh=true`.
 *
 * A failure in one room is logged and does not stop the others; the process
 * exits non-zero if any room failed so systemd records the run as failed.
 *
 * Usage: npm run archive:all
 */
import { loadConfig } from "../src/config/env.js";
import { buildAdapterContext } from "../src/context.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.allowedRooms.length === 0) {
    console.error("Error: GSG_ALLOWED_ROOMS is empty; nothing to archive.");
    process.exit(1);
  }

  const ctx = buildAdapterContext(config);
  let failures = 0;
  for (const room of config.allowedRooms) {
    try {
      const result = await ctx.archive.archiveRoom(room);
      console.log(JSON.stringify({ event: "technocore_archive_pass", ...result }));
      if (result.gapDetected) {
        console.warn(JSON.stringify({ event: "technocore_archive_gap", room }));
      }
    } catch (err) {
      failures++;
      console.error(
        JSON.stringify({ event: "technocore_archive_failed", room, message: (err as Error).message }),
      );
    }
  }
  ctx.db.close();
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
