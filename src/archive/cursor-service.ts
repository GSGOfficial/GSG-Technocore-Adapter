import type { TechnocoreDatabase } from "../db/database.js";

export interface CursorService {
  getCursor(room: string): Promise<number>;
  advanceCursor(room: string, sequence: number): Promise<void>;
  /** Records that the room was polled, even if nothing new arrived. */
  markPolled(room: string): Promise<void>;
}

export class SqliteCursorService implements CursorService {
  constructor(private readonly db: TechnocoreDatabase) {}

  async getCursor(room: string): Promise<number> {
    const row = this.db
      .prepare("SELECT last_sequence FROM technocore_room_cursors WHERE room = ?")
      .get(room) as { last_sequence: number } | undefined;
    return row?.last_sequence ?? 0;
  }

  async advanceCursor(room: string, sequence: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO technocore_room_cursors (room, last_sequence, last_polled_at, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(room) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           last_polled_at = excluded.last_polled_at,
           updated_at = excluded.updated_at`,
      )
      .run(room, sequence);
  }

  async markPolled(room: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO technocore_room_cursors (room, last_sequence, last_polled_at, updated_at)
         VALUES (?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(room) DO UPDATE SET last_polled_at = excluded.last_polled_at`,
      )
      .run(room);
  }
}

/** In-process cursor tracking for unit tests only. */
export class InMemoryCursorService implements CursorService {
  private readonly cursors = new Map<string, number>();

  async getCursor(room: string): Promise<number> {
    return this.cursors.get(room) ?? 0;
  }

  async advanceCursor(room: string, sequence: number): Promise<void> {
    this.cursors.set(room, sequence);
  }

  async markPolled(_room: string): Promise<void> {}
}
