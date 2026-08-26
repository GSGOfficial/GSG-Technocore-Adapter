import type { TechnocoreDatabase } from "../db/database.js";
import { nonceError } from "../client/technocore-errors.js";

export interface NonceAllocator {
  /** Atomically allocates the next nonce for (agentId, room). */
  allocateNonce(agentId: string, room: string): Promise<bigint>;
}

/**
 * Allocates nonces via a single INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING statement. better-sqlite3 executes synchronously and SQLite
 * serializes all writes against the database file, so this single
 * statement is inherently atomic — no explicit row locking or a separate
 * SELECT-then-UPDATE round trip is needed, and it stays correct even if
 * multiple adapter processes share the same database file.
 */
export class SqliteNonceAllocator implements NonceAllocator {
  constructor(private readonly db: TechnocoreDatabase) {}

  async allocateNonce(agentId: string, room: string): Promise<bigint> {
    try {
      const row = this.db
        .prepare(
          `INSERT INTO technocore_agent_nonces (agent_id, room, last_nonce, updated_at)
           VALUES (?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(agent_id, room) DO UPDATE SET
             last_nonce = last_nonce + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           RETURNING last_nonce`,
        )
        .get(agentId, room) as { last_nonce: number } | undefined;
      if (!row) throw nonceError(`Nonce allocation for agent ${agentId} in room ${room} returned no row.`);
      return BigInt(row.last_nonce);
    } catch (err) {
      if (err instanceof Error && err.name === "TechnocoreError") throw err;
      throw nonceError(`Failed to allocate nonce for agent ${agentId} in room ${room}: ${(err as Error).message}`);
    }
  }
}

/**
 * In-process fallback for unit tests only. Node's single-threaded event
 * loop makes a synchronous Map increment safe within one process, but this
 * does NOT persist across restarts or coordinate across processes.
 */
export class InMemoryNonceAllocator implements NonceAllocator {
  private readonly lastNonce = new Map<string, bigint>();

  async allocateNonce(agentId: string, room: string): Promise<bigint> {
    const key = `${agentId}:${room}`;
    const next = (this.lastNonce.get(key) ?? BigInt(0)) + BigInt(1);
    this.lastNonce.set(key, next);
    return next;
  }
}
