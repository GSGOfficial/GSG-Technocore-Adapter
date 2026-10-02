import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createStandaloneApp } from "../../src/index.js";
import { buildAdapterContext, type AdapterContext } from "../../src/context.js";
import type { AdapterConfig } from "../../src/config/env.js";
import { SqliteAgentRegistry } from "../../src/agents/agent-registry.js";
import { generateKeyPair, publicKeyToDid } from "../../src/identity/did-key.js";
import { encryptSecretKey } from "../../src/identity/identity-store.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const API_KEY = "test-gsg-api-key";

function testConfig(): AdapterConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 8787,
    technocoreBaseUrl: "https://technocore.chat",
    defaultReadLimit: 50,
    longPollSeconds: 0,
    requestTimeoutMs: 2000,
    maxRetries: 0,
    maxResponseBytes: 1024 * 1024,
    allowUnsignedDev: false,
    dbPath: ":memory:",
    gsgApiKey: API_KEY,
    allowedRooms: ["gsg-financial", "gsg-validation"],
    identityEncryptionKey: ENCRYPTION_KEY,
  };
}

function seedActiveAgent(ctx: AdapterContext, slug: string) {
  const registry = ctx.agents as SqliteAgentRegistry;
  const { publicKey, secretKey } = generateKeyPair();
  const publicDid = publicKeyToDid(publicKey);
  const encryptedSecretKey = encryptSecretKey(secretKey, ENCRYPTION_KEY);
  registry.createAgent({
    slug,
    displayName: slug,
    publicDid,
    encryptedSecretKey,
    allowedRooms: ["gsg-financial"],
    canRead: true,
    canPublish: true,
    status: "active",
  });
  return { publicDid, secretKey };
}

describe("technocore adapter API", () => {
  let ctx: AdapterContext;
  const originalFetch = global.fetch;

  beforeEach(() => {
    ctx = buildAdapterContext(testConfig());
  });

  afterEach(() => {
    ctx.db.close();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /api/technocore/health returns ok without leaking config", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app).get("/api/technocore/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);
    expect(JSON.stringify(res.body)).not.toContain(ENCRYPTION_KEY);
  });

  it("GET /api/technocore/rooms returns only the allowlisted rooms", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app).get("/api/technocore/rooms");
    expect(res.status).toBe(200);
    const roomNames = res.body.data.rooms.map((r: { room: string }) => r.room);
    expect(roomNames).toEqual(["gsg-financial", "gsg-validation"]);
  });

  it("GET /api/technocore/rooms/:room/messages rejects a room not on the allowlist", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app).get("/api/technocore/rooms/not-approved/messages");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TECHNOCORE_INVALID_ROOM");
  });

  it("POST /api/technocore/rooms/:room/messages requires authentication", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Idempotency-Key", "k-1")
      .send({ agentSlug: "gsg-financial-agent", text: "hi" });
    expect(res.status).toBe(401);
  });

  it("POST rejects an inactive/unknown agent even with valid auth", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "k-2")
      .send({ agentSlug: "does-not-exist", text: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TECHNOCORE_AGENT_NOT_FOUND");
  });

  it("publishes a signed message end to end and archives it", async () => {
    const { publicDid } = seedActiveAgent(ctx, "gsg-financial-agent");

    const fetchMock = vi.fn(async (_url: URL) => {
      return new Response(
        JSON.stringify({
          room: "gsg-financial",
          count: 1,
          first_seq: 101,
          last_seq: 101,
          messages: [{ seq: 101, ts: "2026-08-26T00:00:00Z", from: publicDid, text: "Quarterly summary.", nonce: 1 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const app = createStandaloneApp(ctx);
    const res = await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "k-3")
      .send({ agentSlug: "gsg-financial-agent", text: "Quarterly summary." });

    expect(res.status).toBe(200);
    expect(res.body.data.did).toBe(publicDid);
    expect(res.body.data.sequence).toBe(101);
    expect(res.body.data.archived).toBe(true);

    // Upstream answers writes with a plain-text room view unless JSON is
    // requested explicitly.
    const writeUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(writeUrl.pathname).toContain("/say-signed/");
    expect(writeUrl.searchParams.get("format")).toBe("json");

    const archived = ctx.db
      .prepare("SELECT * FROM technocore_messages WHERE room = ? AND direction = 'outbound'")
      .all("gsg-financial");
    expect(archived).toHaveLength(1);
  });

  it("rejects a reused idempotency key with different message content", async () => {
    seedActiveAgent(ctx, "gsg-financial-agent");
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ room: "gsg-financial", count: 0, first_seq: null, last_seq: 1, messages: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const app = createStandaloneApp(ctx);
    await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "k-4")
      .send({ agentSlug: "gsg-financial-agent", text: "first version" });

    const res = await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "k-4")
      .send({ agentSlug: "gsg-financial-agent", text: "conflicting version" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TECHNOCORE_IDEMPOTENCY_CONFLICT");
  });

  it("PATCH /api/technocore/agents/:slug/status requires authentication", async () => {
    seedActiveAgent(ctx, "gsg-financial-agent");
    const app = createStandaloneApp(ctx);
    const res = await request(app)
      .patch("/api/technocore/agents/gsg-financial-agent/status")
      .send({ status: "revoked" });
    expect(res.status).toBe(401);
  });

  it("returns a validation error, not an upstream error, for an invalid contribution body", async () => {
    const app = createStandaloneApp(ctx);
    const res = await request(app)
      .post("/api/technocore/contributions")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TECHNOCORE_INVALID_MESSAGE");
    expect(res.body.error.message).toContain("title");
  });

  it("logs one publish event per attempt, without the message text", async () => {
    const { publicDid } = seedActiveAgent(ctx, "gsg-financial-agent");
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          room: "gsg-financial",
          count: 1,
          first_seq: 7,
          last_seq: 7,
          messages: [{ seq: 7, ts: "2026-10-02T00:00:00Z", from: publicDid, text: "Secret-free summary.", nonce: 1 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const app = createStandaloneApp(ctx);
    await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "log-1")
      .send({ agentSlug: "gsg-financial-agent", text: "Secret-free summary." });
    await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "log-2")
      .send({ agentSlug: "does-not-exist", text: "hi" });

    const lines = [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => String(c[0]));
    const events = lines
      .filter((l) => l.includes("technocore_publish"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      outcome: "published",
      agent: "gsg-financial-agent",
      room: "gsg-financial",
      idempotencyKey: "log-1",
      nonce: "1",
      sequence: 7,
    });
    expect(typeof events[0]?.requestId).toBe("string");
    expect(events[1]).toMatchObject({
      outcome: "rejected",
      agent: "does-not-exist",
      errorCode: "TECHNOCORE_AGENT_NOT_FOUND",
    });
    expect(lines.join("\n")).not.toContain("Secret-free summary.");
  });

  it("logs rejected credentials without echoing them", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createStandaloneApp(ctx);
    await request(app)
      .post("/api/technocore/rooms/gsg-financial/messages")
      .set("Authorization", "Bearer not-the-key")
      .set("Idempotency-Key", "k-auth")
      .send({ agentSlug: "gsg-financial-agent", text: "hi" });
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("technocore_auth_rejected"))).toBe(true);
    expect(lines.join("\n")).not.toContain("not-the-key");
  });
});
