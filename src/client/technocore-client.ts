import type { AdapterConfig } from "../config/env.js";
import { validateRoomName } from "../security/room-policy.js";
import {
  validateDidFormat,
  validateMessageText,
  validateNickname,
  validateNonceFormat,
  validateSignatureFormat,
} from "../security/input-validation.js";
import {
  rateLimitedError,
  timeoutError,
  upstreamError,
  invalidMessageError,
  isTechnocoreError,
} from "./technocore-errors.js";
import {
  UpstreamReadResponseSchema,
  normalizeUpstreamMessage,
  type ReadRoomOptions,
  type ReadRoomResult,
} from "./technocore-types.js";

export interface TechnocoreClientOptions {
  baseUrl: string;
  requestTimeoutMs: number;
  maxRetries: number;
  maxResponseBytes: number;
  allowUnsignedDev: boolean;
}

export function clientOptionsFromConfig(config: AdapterConfig): TechnocoreClientOptions {
  return {
    baseUrl: config.technocoreBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    maxResponseBytes: config.maxResponseBytes,
    allowUnsignedDev: config.allowUnsignedDev,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffWithJitter(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return base / 2 + Math.random() * (base / 2);
}

/** Retry only network errors, 429, and transient 5xx — never validation/auth errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export class TechnocoreClient {
  constructor(private readonly options: TechnocoreClientOptions) {}

  /**
   * Every request path segment is percent-encoded independently and the
   * origin is fixed to the configured, allowlisted base URL — callers can
   * never inject an arbitrary upstream URL. Redirects are refused so a
   * compromised/misbehaving upstream can't retarget requests off-origin.
   */
  private async requestWithRetry(pathSegments: string[], query?: Record<string, string>): Promise<unknown> {
    const url = new URL(this.options.baseUrl);
    url.pathname = "/" + pathSegments.map((s) => encodeURIComponent(s)).join("/");
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }

    let lastError: Error = upstreamError("Request failed with no attempts made.");
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: { accept: "application/json,text/plain" },
        });
        clearTimeout(timer);

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "1");
          if (attempt < this.options.maxRetries) {
            await sleep(Math.max(retryAfter, 1) * 1000);
            continue;
          }
          throw rateLimitedError("Technocore rate-limited this request.", retryAfter);
        }

        if (!response.ok) {
          const bodyText = await this.readBoundedText(response);
          if (isRetryableStatus(response.status) && attempt < this.options.maxRetries) {
            lastError = upstreamError(`Upstream returned ${response.status}: ${bodyText}`, {
              status: response.status,
            });
            await sleep(backoffWithJitter(attempt));
            continue;
          }
          if (response.status === 400) throw invalidMessageError(bodyText || "Malformed request.");
          throw upstreamError(`Upstream returned ${response.status}: ${bodyText}`, {
            status: response.status,
          });
        }

        const text = await this.readBoundedText(response);
        try {
          return JSON.parse(text);
        } catch {
          throw upstreamError("Upstream response was not valid JSON.");
        }
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === "AbortError") {
          if (attempt < this.options.maxRetries) {
            lastError = timeoutError(`Request to Technocore timed out after ${this.options.requestTimeoutMs}ms.`);
            await sleep(backoffWithJitter(attempt));
            continue;
          }
          throw timeoutError(`Request to Technocore timed out after ${this.options.requestTimeoutMs}ms.`);
        }
        if (isTechnocoreError(err)) {
          // Rethrow already-typed TechnocoreError instances immediately
          // (e.g. validation/auth errors) — only network/HTTP failures retry.
          throw err;
        }
        lastError = err as Error;
        if (attempt < this.options.maxRetries) {
          await sleep(backoffWithJitter(attempt));
          continue;
        }
        throw upstreamError(`Network error contacting Technocore: ${lastError.message}`);
      }
    }
    throw lastError;
  }

  private async readBoundedText(response: Response): Promise<string> {
    if (!response.body) return response.text();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > this.options.maxResponseBytes) {
          await reader.cancel();
          throw upstreamError(
            `Upstream response exceeded the ${this.options.maxResponseBytes}-byte cap.`,
          );
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }

  async readRoom(room: string, options: ReadRoomOptions = {}): Promise<ReadRoomResult> {
    validateRoomName(room);
    const query: Record<string, string> = { format: "json" };
    if (options.since !== undefined) query.since = String(options.since);
    if (options.limit !== undefined) query.limit = String(options.limit);
    if (options.wait !== undefined) query.wait = String(options.wait);

    const raw = await this.requestWithRetry(["r", room], query);
    const parsed = UpstreamReadResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw upstreamError(`Upstream read response failed schema validation: ${parsed.error.message}`);
    }
    return {
      room: parsed.data.room,
      firstSequence: parsed.data.first_seq,
      lastSequence: parsed.data.last_seq,
      messages: parsed.data.messages.map((m) => normalizeUpstreamMessage(room, m)),
    };
  }

  /** Disabled unless explicitly enabled for a specific development agent. */
  async sayUnsigned(room: string, nickname: string, text: string): Promise<ReadRoomResult> {
    if (!this.options.allowUnsignedDev) {
      throw invalidMessageError("Unsigned publishing is disabled in this deployment.");
    }
    validateRoomName(room);
    validateNickname(nickname);
    const normalizedText = validateMessageText(text);
    const raw = await this.requestWithRetry(["r", room, "say", nickname, normalizedText]);
    const parsed = UpstreamReadResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw upstreamError(`Upstream write response failed schema validation: ${parsed.error.message}`);
    }
    return {
      room: parsed.data.room,
      firstSequence: parsed.data.first_seq,
      lastSequence: parsed.data.last_seq,
      messages: parsed.data.messages.map((m) => normalizeUpstreamMessage(room, m)),
    };
  }

  async saySigned(
    room: string,
    did: string,
    signature: string,
    nonce: string,
    normalizedText: string,
  ): Promise<ReadRoomResult> {
    validateRoomName(room);
    validateDidFormat(did);
    validateSignatureFormat(signature);
    validateNonceFormat(nonce);
    // Text was already normalized+validated at signing time; re-validate
    // defensively so this method is safe to call on its own.
    const text = validateMessageText(normalizedText);

    const raw = await this.requestWithRetry(["r", room, "say-signed", did, signature, nonce, text]);
    const parsed = UpstreamReadResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw upstreamError(`Upstream write response failed schema validation: ${parsed.error.message}`);
    }
    return {
      room: parsed.data.room,
      firstSequence: parsed.data.first_seq,
      lastSequence: parsed.data.last_seq,
      messages: parsed.data.messages.map((m) => normalizeUpstreamMessage(room, m)),
    };
  }
}
