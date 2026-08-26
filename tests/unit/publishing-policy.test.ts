import { describe, expect, it } from "vitest";
import { enforcePublishingPolicy, TokenBucketRateLimiter } from "../../src/agents/publishing-policy.js";
import { InMemoryPublishRequestService } from "../../src/archive/publish-request-service.js";
import type { GsgTechnocoreAgent } from "../../src/client/technocore-types.js";
import { isTechnocoreError } from "../../src/client/technocore-errors.js";

function makeAgent(overrides: Partial<GsgTechnocoreAgent> = {}): GsgTechnocoreAgent {
  return {
    id: "agent-1",
    slug: "gsg-financial-agent",
    displayName: "GSG Financial Agent",
    publicDid: `did:key:z6Mk${"a".repeat(44)}`,
    status: "active",
    allowedRooms: ["gsg-financial"],
    canRead: true,
    canPublish: true,
    ...overrides,
  };
}

describe("enforcePublishingPolicy", () => {
  it("passes for an active, permitted agent publishing valid text", async () => {
    const result = await enforcePublishingPolicy({
      agent: makeAgent(),
      room: "gsg-financial",
      text: "Quarterly summary archived.",
      idempotencyKey: "key-1",
      rateLimiter: new TokenBucketRateLimiter(10, 1),
    });
    expect(result.normalizedText).toBe("Quarterly summary archived.");
  });

  it("rejects a paused agent", async () => {
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent({ status: "paused" }),
        room: "gsg-financial",
        text: "hello",
        idempotencyKey: "key-2",
        rateLimiter: new TokenBucketRateLimiter(10, 1),
      }),
    ).rejects.toSatisfy((err) => isTechnocoreError(err) && err.code === "TECHNOCORE_AGENT_INACTIVE");
  });

  it("rejects an agent without publish permission", async () => {
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent({ canPublish: false }),
        room: "gsg-financial",
        text: "hello",
        idempotencyKey: "key-3",
        rateLimiter: new TokenBucketRateLimiter(10, 1),
      }),
    ).rejects.toThrow();
  });

  it("rejects a room not in the agent's allowlist", async () => {
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent(),
        room: "gsg-sports",
        text: "hello",
        idempotencyKey: "key-4",
        rateLimiter: new TokenBucketRateLimiter(10, 1),
      }),
    ).rejects.toThrow();
  });

  it("rejects text containing a detected secret", async () => {
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent(),
        room: "gsg-financial",
        text: "here is a key AKIAABCDEFGHIJKLMNOP",
        idempotencyKey: "key-5",
        rateLimiter: new TokenBucketRateLimiter(10, 1),
      }),
    ).rejects.toSatisfy((err) => isTechnocoreError(err) && err.code === "TECHNOCORE_INVALID_MESSAGE");
  });

  it("rejects a reused idempotency key with different content", async () => {
    const checker = new InMemoryPublishRequestService();
    await checker.createPending({ idempotencyKey: "dup-key", messageHash: "hash-of-original" });
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent(),
        room: "gsg-financial",
        text: "different content",
        idempotencyKey: "dup-key",
        rateLimiter: new TokenBucketRateLimiter(10, 1),
        idempotencyChecker: checker,
      }),
    ).rejects.toSatisfy((err) => isTechnocoreError(err) && err.code === "TECHNOCORE_IDEMPOTENCY_CONFLICT");
  });

  it("enforces the rate limit", async () => {
    const rateLimiter = new TokenBucketRateLimiter(1, 0); // capacity 1, no refill
    await enforcePublishingPolicy({
      agent: makeAgent(),
      room: "gsg-financial",
      text: "first",
      idempotencyKey: "key-6",
      rateLimiter,
    });
    await expect(
      enforcePublishingPolicy({
        agent: makeAgent(),
        room: "gsg-financial",
        text: "second",
        idempotencyKey: "key-7",
        rateLimiter,
      }),
    ).rejects.toSatisfy((err) => isTechnocoreError(err) && err.code === "TECHNOCORE_RATE_LIMITED");
  });
});
