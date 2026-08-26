import { describe, expect, it, beforeEach } from "vitest";
import { openDatabase, type TechnocoreDatabase } from "../../src/db/database.js";
import { SqliteNonceAllocator } from "../../src/identity/nonce-manager.js";
import { randomUUID } from "node:crypto";

function seedAgent(db: TechnocoreDatabase, id: string): void {
  db.prepare(
    `INSERT INTO technocore_agents (id, slug, display_name, public_did, encrypted_identity, allowed_rooms)
     VALUES (?, ?, ?, ?, ?, '[]')`,
  ).run(id, id, id, `did:key:z6Mk${"a".repeat(44)}`, "encrypted-blob");
}

describe("SqliteNonceAllocator", () => {
  let db: TechnocoreDatabase;
  let agentId: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    agentId = randomUUID();
    seedAgent(db, agentId);
  });

  it("starts at 1 for a fresh (agent, room) pair", async () => {
    const allocator = new SqliteNonceAllocator(db);
    const nonce = await allocator.allocateNonce(agentId, "gsg-financial");
    expect(nonce).toBe(1n);
  });

  it("strictly increases on each call for the same (agent, room)", async () => {
    const allocator = new SqliteNonceAllocator(db);
    const first = await allocator.allocateNonce(agentId, "gsg-financial");
    const second = await allocator.allocateNonce(agentId, "gsg-financial");
    const third = await allocator.allocateNonce(agentId, "gsg-financial");
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("tracks separate counters per room for the same agent", async () => {
    const allocator = new SqliteNonceAllocator(db);
    const a = await allocator.allocateNonce(agentId, "gsg-financial");
    const b = await allocator.allocateNonce(agentId, "gsg-publishing");
    expect(a).toBe(1n);
    expect(b).toBe(1n);
  });

  it("remains correct under concurrent allocation for the same (agent, room)", async () => {
    const allocator = new SqliteNonceAllocator(db);
    const results = await Promise.all(
      Array.from({ length: 25 }, () => allocator.allocateNonce(agentId, "gsg-financial")),
    );
    const unique = new Set(results.map(String));
    expect(unique.size).toBe(25); // no two concurrent calls got the same nonce
    expect(Math.max(...results.map(Number))).toBe(25);
  });
});
