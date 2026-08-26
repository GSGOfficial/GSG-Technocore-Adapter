import { randomUUID } from "node:crypto";
import type { TechnocoreDatabase } from "../db/database.js";
import type { IdempotencyChecker, IdempotencyRecord, IdempotencyStatus } from "../agents/publishing-policy.js";

/**
 * Backs both the IdempotencyChecker used by the publishing policy gate and
 * the bookkeeping needed to reconcile an "unknown" result (an upstream
 * timeout where the message may or may not have actually landed).
 */
export class SqlitePublishRequestService implements IdempotencyChecker {
  constructor(private readonly db: TechnocoreDatabase) {}

  async find(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const row = this.db
      .prepare("SELECT status, message_hash FROM technocore_publish_requests WHERE idempotency_key = ?")
      .get(idempotencyKey) as { status: IdempotencyStatus; message_hash: string } | undefined;
    if (!row) return null;
    return { status: row.status, messageHash: row.message_hash };
  }

  async createPending(params: {
    idempotencyKey: string;
    agentId: string;
    room: string;
    messageHash: string;
    nonce: string;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO technocore_publish_requests
           (id, idempotency_key, agent_id, room, message_hash, nonce, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(randomUUID(), params.idempotencyKey, params.agentId, params.room, params.messageHash, params.nonce);
  }

  async markPublished(idempotencyKey: string, upstreamSequence: number | null): Promise<void> {
    this.db
      .prepare(
        `UPDATE technocore_publish_requests
         SET status = 'published', upstream_sequence = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE idempotency_key = ?`,
      )
      .run(upstreamSequence, idempotencyKey);
  }

  async markFailed(idempotencyKey: string, errorCode: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE technocore_publish_requests
         SET status = 'failed', error_code = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE idempotency_key = ?`,
      )
      .run(errorCode, idempotencyKey);
  }

  async markUnknown(idempotencyKey: string): Promise<void> {
    this.db
      .prepare("UPDATE technocore_publish_requests SET status = 'unknown' WHERE idempotency_key = ?")
      .run(idempotencyKey);
  }
}

/** In-process implementation for unit tests only. */
export class InMemoryPublishRequestService implements IdempotencyChecker {
  private readonly records = new Map<string, IdempotencyRecord & { upstreamSequence: number | null }>();

  async find(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    return this.records.get(idempotencyKey) ?? null;
  }

  async createPending(params: { idempotencyKey: string; messageHash: string }): Promise<void> {
    this.records.set(params.idempotencyKey, {
      status: "pending",
      messageHash: params.messageHash,
      upstreamSequence: null,
    });
  }

  async markPublished(idempotencyKey: string, upstreamSequence: number | null): Promise<void> {
    const existing = this.records.get(idempotencyKey);
    if (existing) this.records.set(idempotencyKey, { ...existing, status: "published", upstreamSequence });
  }

  async markFailed(idempotencyKey: string): Promise<void> {
    const existing = this.records.get(idempotencyKey);
    if (existing) this.records.set(idempotencyKey, { ...existing, status: "failed" });
  }

  async markUnknown(idempotencyKey: string): Promise<void> {
    const existing = this.records.get(idempotencyKey);
    if (existing) this.records.set(idempotencyKey, { ...existing, status: "unknown" });
  }

  getResult(idempotencyKey: string) {
    return this.records.get(idempotencyKey) ?? null;
  }
}
