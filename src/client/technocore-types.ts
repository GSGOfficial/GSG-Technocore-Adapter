import { z } from "zod";
import { DID_KEY_PATTERN } from "../security/input-validation.js";

/** Raw shapes as actually returned by GET /r/{room}?format=json. */
export const UpstreamMessageSchema = z.object({
  seq: z.number().int(),
  ts: z.string(),
  from: z.string(),
  text: z.string(),
  nonce: z.union([z.number(), z.string()]).optional(),
});
export type UpstreamMessage = z.infer<typeof UpstreamMessageSchema>;

export const UpstreamReadResponseSchema = z.object({
  room: z.string(),
  count: z.number().int(),
  first_seq: z.number().int().nullable(),
  last_seq: z.number().int(),
  messages: z.array(UpstreamMessageSchema),
});
export type UpstreamReadResponse = z.infer<typeof UpstreamReadResponseSchema>;

/** Normalized, adapter-internal message shape used everywhere else in the codebase. */
export interface TechnocoreMessage {
  room: string;
  sequence: number;
  timestamp: string;
  text: string;
  did: string | null;
  nickname: string | null;
  signed: boolean;
  nonce: string | null;
}

export function normalizeUpstreamMessage(room: string, raw: UpstreamMessage): TechnocoreMessage {
  const isDid = DID_KEY_PATTERN.test(raw.from) && raw.nonce !== undefined;
  return {
    room,
    sequence: raw.seq,
    timestamp: raw.ts,
    text: raw.text,
    did: isDid ? raw.from : null,
    nickname: isDid ? null : raw.from,
    signed: isDid,
    nonce: raw.nonce !== undefined ? String(raw.nonce) : null,
  };
}

export interface ReadRoomOptions {
  since?: number;
  limit?: number;
  wait?: number;
}

export interface ReadRoomResult {
  room: string;
  firstSequence: number | null;
  lastSequence: number;
  messages: TechnocoreMessage[];
}

export interface GsgTechnocoreAgent {
  id: string;
  slug: string;
  displayName: string;
  publicDid: string;
  status: "active" | "paused" | "revoked";
  allowedRooms: string[];
  canRead: boolean;
  canPublish: boolean;
}

export interface PublishMessageInput {
  agentSlug: string;
  room: string;
  text: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  /** Correlates the publish log line with the API request that caused it. */
  requestId?: string;
}

export interface PublishMessageResult {
  room: string;
  sequence: number | null;
  did: string;
  signed: true;
  upstreamStatus: number;
  archived: boolean;
}
