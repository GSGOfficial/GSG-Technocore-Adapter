import { randomUUID } from "node:crypto";
import type { TechnocoreClient } from "../client/technocore-client.js";
import type { PublishMessageInput, PublishMessageResult } from "../client/technocore-types.js";
import { isTechnocoreError, unknownPublishResultError } from "../client/technocore-errors.js";
import { decryptSecretKey } from "../identity/identity-store.js";
import { signMessage } from "../identity/message-signer.js";
import type { NonceAllocator } from "../identity/nonce-manager.js";
import type { AgentRegistry } from "./agent-registry.js";
import { enforcePublishingPolicy, type RateLimiter } from "./publishing-policy.js";
import type {
  SqlitePublishRequestService,
  InMemoryPublishRequestService,
} from "../archive/publish-request-service.js";
import type { TechnocoreDatabase } from "../db/database.js";

export interface PublishServiceDeps {
  agents: AgentRegistry;
  technocore: TechnocoreClient;
  nonces: NonceAllocator;
  rateLimiter: RateLimiter;
  publishRequests: SqlitePublishRequestService | InMemoryPublishRequestService;
  identityEncryptionKey: string;
  db: TechnocoreDatabase | null;
}

/**
 * Orchestrates a full signed publish: policy gate -> idempotency
 * short-circuit -> nonce allocation -> sign -> upstream call -> archive.
 * A timeout during the upstream call is marked "unknown" rather than
 * retried blindly, since the message may have already been stored
 * upstream (build plan section 15).
 */
export class PublishService {
  constructor(private readonly deps: PublishServiceDeps) {}

  async publish(input: PublishMessageInput): Promise<PublishMessageResult> {
    const agent = await this.deps.agents.getAgent(input.agentSlug);

    const existing = await this.deps.publishRequests.find(input.idempotencyKey);
    const policyResult = await enforcePublishingPolicy({
      agent,
      room: input.room,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      rateLimiter: this.deps.rateLimiter,
      idempotencyChecker: this.deps.publishRequests,
    });

    if (existing && existing.status === "published") {
      // Same key, same content already succeeded: return without re-publishing.
      return {
        room: input.room,
        sequence: null,
        did: agent.publicDid,
        signed: true,
        upstreamStatus: 200,
        archived: true,
      };
    }
    if (existing && (existing.status === "pending" || existing.status === "unknown")) {
      throw unknownPublishResultError(
        "A previous publish attempt with this idempotency key is still pending or unresolved. " +
          "Check its status before retrying rather than publishing again.",
      );
    }

    const nonce = (await this.deps.nonces.allocateNonce(agent.id, input.room)).toString();

    const signing = await this.deps.agents.getSigningMaterial(agent.slug);
    const secretKey = decryptSecretKey(signing.encryptedSecretKey, this.deps.identityEncryptionKey);

    const signed = signMessage({
      secretKey,
      room: input.room,
      nonce,
      text: policyResult.normalizedText,
    });

    await this.deps.publishRequests.createPending({
      idempotencyKey: input.idempotencyKey,
      agentId: agent.id,
      room: input.room,
      messageHash: policyResult.messageHash,
      nonce,
    });

    let upstreamSequence: number | null = null;
    try {
      const result = await this.deps.technocore.saySigned(
        input.room,
        signed.did,
        signed.signature,
        nonce,
        signed.normalizedText,
      );
      const published = result.messages.find(
        (m) => m.did === signed.did && m.nonce === nonce,
      );
      upstreamSequence = published?.sequence ?? result.lastSequence;
      await this.deps.publishRequests.markPublished(input.idempotencyKey, upstreamSequence);
    } catch (err) {
      if (isTechnocoreError(err) && err.code === "TECHNOCORE_TIMEOUT") {
        await this.deps.publishRequests.markUnknown(input.idempotencyKey);
        throw unknownPublishResultError(
          "Upstream timed out; the message may or may not have been stored. " +
            "Reconcile by re-reading the room for this DID/nonce before retrying.",
        );
      }
      await this.deps.publishRequests.markFailed(
        input.idempotencyKey,
        isTechnocoreError(err) ? err.code : "TECHNOCORE_UPSTREAM_ERROR",
      );
      throw err;
    }

    let archived = false;
    if (this.deps.db && upstreamSequence !== null) {
      try {
        this.deps.db
          .prepare(
            `INSERT OR IGNORE INTO technocore_messages
               (id, room, sequence_number, source_timestamp, message_text, public_did, is_signed, direction, agent_id, metadata)
             VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, 1, 'outbound', ?, ?)`,
          )
          .run(
            randomUUID(),
            input.room,
            upstreamSequence,
            signed.normalizedText,
            signed.did,
            agent.id,
            JSON.stringify(input.metadata ?? {}),
          );
        archived = true;
      } catch {
        archived = false;
      }
    }

    return {
      room: input.room,
      sequence: upstreamSequence,
      did: signed.did,
      signed: true,
      upstreamStatus: 200,
      archived,
    };
  }
}
