/**
 * SQLite schema for the adapter's durable store. Mirrored at
 * db/migrations/001_init.sql for reference/manual inspection via the
 * sqlite3 CLI — this constant is the single source of truth actually
 * applied at startup.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS technocore_agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  public_did TEXT NOT NULL UNIQUE,
  encrypted_identity TEXT NOT NULL,
  allowed_rooms TEXT NOT NULL DEFAULT '[]',
  can_read INTEGER NOT NULL DEFAULT 1,
  can_publish INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS technocore_room_cursors (
  room TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS technocore_agent_nonces (
  agent_id TEXT NOT NULL REFERENCES technocore_agents(id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  last_nonce INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (agent_id, room)
);

CREATE TABLE IF NOT EXISTS technocore_messages (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  source_timestamp TEXT,
  message_text TEXT NOT NULL,
  public_did TEXT,
  nickname TEXT,
  is_signed INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  agent_id TEXT REFERENCES technocore_agents(id) ON DELETE SET NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (room, sequence_number)
);

CREATE TABLE IF NOT EXISTS technocore_publish_requests (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL REFERENCES technocore_agents(id),
  room TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  nonce TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed', 'unknown')),
  upstream_sequence INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS technocore_contributions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  public_url TEXT NOT NULL,
  repository_url TEXT,
  commit_hash TEXT,
  public_did TEXT NOT NULL,
  room TEXT,
  sequence_number INTEGER,
  evidence TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS technocore_messages_room_seq_idx
  ON technocore_messages (room, sequence_number DESC);

CREATE INDEX IF NOT EXISTS technocore_messages_did_idx
  ON technocore_messages (public_did, archived_at DESC);
`;
