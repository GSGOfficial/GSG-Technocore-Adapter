import { randomUUID } from "node:crypto";
import type { TechnocoreDatabase } from "../db/database.js";
import type { TechnocoreClient } from "../client/technocore-client.js";
import type { TechnocoreMessage } from "../client/technocore-types.js";
import type { CursorService } from "./cursor-service.js";

export interface ArchiveRunResult {
  room: string;
  fetched: number;
  inserted: number;
  cursorBefore: number;
  cursorAfter: number;
  gapDetected: boolean;
}

export class ArchiveService {
  constructor(
    private readonly client: TechnocoreClient,
    private readonly db: TechnocoreDatabase,
    private readonly cursors: CursorService,
    private readonly readLimit: number,
  ) {}

  async archiveRoom(room: string): Promise<ArchiveRunResult> {
    const cursorBefore = await this.cursors.getCursor(room);
    const result = await this.client.readRoom(room, { since: cursorBefore, limit: this.readLimit });
    await this.cursors.markPolled(room);

    let gapDetected = false;
    if (cursorBefore > 0 && result.firstSequence !== null && result.firstSequence > cursorBefore + 1) {
      gapDetected = true;
      console.warn(
        JSON.stringify({
          event: "technocore_archive_gap",
          room,
          cursorBefore,
          upstreamFirstSequence: result.firstSequence,
          note: "Upstream ring buffer likely rotated past the last archived cursor.",
        }),
      );
    }

    if (result.messages.length === 0) {
      return { room, fetched: 0, inserted: 0, cursorBefore, cursorAfter: cursorBefore, gapDetected };
    }

    const inserted = this.insertMessages(room, result.messages);

    const highestSequence = Math.max(cursorBefore, ...result.messages.map((m) => m.sequence));
    await this.cursors.advanceCursor(room, highestSequence);

    return {
      room,
      fetched: result.messages.length,
      inserted,
      cursorBefore,
      cursorAfter: highestSequence,
      gapDetected,
    };
  }

  private insertMessages(room: string, messages: TechnocoreMessage[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO technocore_messages
         (id, room, sequence_number, source_timestamp, message_text, public_did, nickname, is_signed, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inbound')`,
    );
    const insertMany = this.db.transaction((rows: TechnocoreMessage[]) => {
      let count = 0;
      for (const m of rows) {
        const result = insert.run(
          randomUUID(),
          room,
          m.sequence,
          m.timestamp,
          m.text,
          m.did,
          m.nickname,
          m.signed ? 1 : 0,
        );
        count += result.changes;
      }
      return count;
    });
    return insertMany(messages);
  }
}
