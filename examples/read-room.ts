/**
 * Minimal example: read the most recent messages from an approved
 * Technocore room through this adapter's client, without any server
 * scaffolding. Run with: npx tsx examples/read-room.ts <room>
 */
import { TechnocoreClient, clientOptionsFromConfig } from "../src/client/technocore-client.js";
import { loadConfig } from "../src/config/env.js";

async function main(): Promise<void> {
  const room = process.argv[2];
  if (!room) {
    console.error("Usage: npx tsx examples/read-room.ts <room>");
    process.exit(1);
  }

  const config = loadConfig();
  const client = new TechnocoreClient(clientOptionsFromConfig(config));

  const result = await client.readRoom(room, { limit: 20 });
  console.log(`Room "${room}" — last_sequence=${result.lastSequence}`);
  for (const message of result.messages) {
    const author = message.signed ? message.did : message.nickname ?? "anon";
    console.log(`[${message.sequence}] (${author}) ${message.text}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
