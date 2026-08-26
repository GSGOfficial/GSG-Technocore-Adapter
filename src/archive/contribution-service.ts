import { randomUUID } from "node:crypto";
import type { TechnocoreDatabase } from "../db/database.js";

export interface ContributionRecord {
  id?: string;
  title: string;
  description: string;
  publicUrl: string;
  repositoryUrl?: string;
  commitHash?: string;
  publicDid: string;
  room?: string;
  sequenceNumber?: number;
  evidence?: Record<string, unknown>;
  publishedAt?: string;
}

interface ContributionRow {
  id: string;
  title: string;
  description: string;
  public_url: string;
  repository_url: string | null;
  commit_hash: string | null;
  public_did: string;
  room: string | null;
  sequence_number: number | null;
  evidence: string;
  published_at: string | null;
}

function fromRow(row: ContributionRow): ContributionRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    publicUrl: row.public_url,
    repositoryUrl: row.repository_url ?? undefined,
    commitHash: row.commit_hash ?? undefined,
    publicDid: row.public_did,
    room: row.room ?? undefined,
    sequenceNumber: row.sequence_number ?? undefined,
    evidence: JSON.parse(row.evidence) as Record<string, unknown>,
    publishedAt: row.published_at ?? undefined,
  };
}

export class ContributionService {
  constructor(private readonly db: TechnocoreDatabase) {}

  async create(record: ContributionRecord): Promise<ContributionRecord> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO technocore_contributions
           (id, title, description, public_url, repository_url, commit_hash, public_did, room, sequence_number, evidence, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        record.title,
        record.description,
        record.publicUrl,
        record.repositoryUrl ?? null,
        record.commitHash ?? null,
        record.publicDid,
        record.room ?? null,
        record.sequenceNumber ?? null,
        JSON.stringify(record.evidence ?? {}),
        record.publishedAt ?? null,
      );
    return { ...record, id };
  }

  async list(): Promise<ContributionRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM technocore_contributions ORDER BY created_at DESC")
      .all() as ContributionRow[];
    return rows.map(fromRow);
  }
}
