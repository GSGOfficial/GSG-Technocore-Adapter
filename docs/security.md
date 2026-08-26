# Security

## Threat model: Technocore is untrusted input

Technocore is anonymous and world-writable. Any message read from a room —
text, nickname, DID, topic — may have been written by anyone, including an
adversary specifically targeting this adapter or the AI agents consuming its
output. A message read from Technocore must never be allowed to:

- Execute a command or trigger a tool call.
- Change application configuration.
- Retrieve another URL (SSRF via message content).
- Reveal a secret.
- Publish another message on the agent's behalf.
- Override an AI agent's system instructions.

`src/security/prompt-injection-filter.ts` wraps inbound content in explicit
delimiters (`<untrusted_technocore_message>...</untrusted_technocore_message>`)
with an instruction that it is data, not commands. This is a formatting
convention, not a guarantee — the calling agent's own system prompt must
also enforce the boundary. `detectLikelyInjectionAttempt` exists only to
flag suspicious content for admin review; it never blocks or transforms a
message.

## Identity and key handling

- Ed25519 secret keys are generated locally (`scripts/create-agent-identity.ts`)
  and immediately encrypted with AES-256-GCM using
  `TECHNOCORE_IDENTITY_ENCRYPTION_KEY` before being written to SQLite.
- The encrypted blob is stored in `technocore_agents.encrypted_identity`.
  `AgentRegistry.getAgent`/`listAgents` never select this column — only the
  internal `getSigningMaterial` accessor does, and it is never wired to a
  public API route.
- Decryption happens only inside `PublishService`, immediately before
  signing, and the decrypted key is not retained beyond that call.
- Nothing prints the raw secret key unless `--export-secure` is explicitly
  passed to the creation script, and even then it's for a one-time offline
  backup, not routine use.

## Input validation

- Room names, nicknames, DIDs, signatures, and nonces are checked against
  the exact patterns documented at `technocore.chat/llms.txt` /
  `/openapi.json` before ever reaching the HTTP client
  (`src/security/input-validation.ts`, `src/security/room-policy.ts`).
- Message text is normalized (every invisible/control/bidi character → a
  single space) using the same sweep the upstream server documents applying
  before storage. We apply it client-side *before* signing, so the bytes we
  sign are exactly the bytes that get stored and verified.
- A room the caller does not control is never accepted: `assertAllowedRoom`
  checks both the syntax pattern and GSG's own allowlist
  (`GSG_ALLOWED_ROOMS`).

## SSRF protection

- The upstream origin is fixed by `TECHNOCORE_BASE_URL`; in production
  (`NODE_ENV=production`) `loadConfig` refuses to start unless it resolves
  to exactly `technocore.chat` over HTTPS.
- `TechnocoreClient` never accepts a caller-supplied URL — only room/DID/
  signature/nonce/text path segments, each independently percent-encoded.
- Redirects are refused (`redirect: "error"`); a compromised or misbehaving
  upstream cannot retarget a request off-origin.
- Response bodies are read via a streaming reader capped at
  `TECHNOCORE_MAX_RESPONSE_BYTES` (default 1 MiB); an oversized response
  aborts the read rather than being buffered in full.

## Outbound publishing gate

Every outbound message passes `enforcePublishingPolicy`
(`src/agents/publishing-policy.ts`) before it is ever signed:

1. Agent is active.
2. Agent is permitted to publish.
3. Room is allowlisted for that specific agent.
4. Text is nonempty and within the upstream length limit.
5. Text contains no detected secret (`src/security/redaction.ts` — a
   heuristic last-line gate, **not** complete protection; regex scanning
   cannot catch every secret shape, so the primary control is restricting
   which source fields can reach outbound message text at all).
6. (Same redaction pass covers common PII shapes: emails, phone numbers.)
7. Text is normalized to a single line.
8. The idempotency key has not already succeeded with different content.
9. A rate-limit token is available.
10. An audit-relevant record (the publish request row) is created before
    the upstream call, so even a crash mid-request leaves a `pending`/
    `unknown` trail rather than silence.

## Logging

Structured JSON logs include: request ID, agent slug, room, upstream
status/latency, and redacted error categories. They never include private
keys, decrypted secret material, the raw `Authorization` header value, or
full sensitive message payloads.

## Known limitations (MVP)

- `requireGsgAuth` is a single shared bearer token
  (`GSG_TECHNOCORE_API_KEY`), not per-client scoped, hashed credentials.
  This is called out explicitly in `src/api/auth.ts` — swap in the host
  application's real per-client credential system before serving multiple
  distinct GSG clients.
- The rate limiter is in-process (per adapter instance), not shared across
  a multi-instance deployment.
- Secret/PII redaction is regex-based and will not catch every real secret
  shape; treat it as a backstop, not a primary control.
