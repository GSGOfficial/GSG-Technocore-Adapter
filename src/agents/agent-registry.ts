import { randomUUID } from "node:crypto";
import type { TechnocoreDatabase } from "../db/database.js";
import { agentNotFoundError, agentInactiveError, agentForbiddenError } from "../client/technocore-errors.js";
import type { GsgTechnocoreAgent } from "../client/technocore-types.js";

interface TechnocoreAgentRow {
  id: string;
  slug: string;
  display_name: string;
  public_did: string;
  status: "active" | "paused" | "revoked";
  allowed_rooms: string;
  can_read: number;
  can_publish: number;
}

function rowToAgent(row: TechnocoreAgentRow): GsgTechnocoreAgent {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    publicDid: row.public_did,
    status: row.status,
    allowedRooms: JSON.parse(row.allowed_rooms) as string[],
    canRead: Boolean(row.can_read),
    canPublish: Boolean(row.can_publish),
  };
}

export interface SigningMaterial {
  publicDid: string;
  encryptedSecretKey: string;
}

export interface CreateAgentInput {
  slug: string;
  displayName: string;
  publicDid: string;
  encryptedSecretKey: string;
  allowedRooms: string[];
  canRead?: boolean;
  canPublish?: boolean;
  status?: GsgTechnocoreAgent["status"];
}

export interface AgentRegistry {
  getAgent(slug: string): Promise<GsgTechnocoreAgent>;
  listAgents(): Promise<GsgTechnocoreAgent[]>;
  setStatus(slug: string, status: GsgTechnocoreAgent["status"]): Promise<GsgTechnocoreAgent>;
  /**
   * Internal-only accessor for the encrypted secret key material needed to
   * sign outbound messages. Never wire this to a public API route or view —
   * only `getAgent`/`listAgents`, which omit it, may be exposed externally.
   */
  getSigningMaterial(slug: string): Promise<SigningMaterial>;
}

const SELECT_COLUMNS = "id, slug, display_name, public_did, status, allowed_rooms, can_read, can_publish";

export class SqliteAgentRegistry implements AgentRegistry {
  constructor(private readonly db: TechnocoreDatabase) {}

  async getAgent(slug: string): Promise<GsgTechnocoreAgent> {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM technocore_agents WHERE slug = ?`)
      .get(slug) as TechnocoreAgentRow | undefined;
    if (!row) throw agentNotFoundError(slug);
    return rowToAgent(row);
  }

  async listAgents(): Promise<GsgTechnocoreAgent[]> {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM technocore_agents`)
      .all() as TechnocoreAgentRow[];
    return rows.map(rowToAgent);
  }

  async setStatus(slug: string, status: GsgTechnocoreAgent["status"]): Promise<GsgTechnocoreAgent> {
    const result = this.db
      .prepare(
        `UPDATE technocore_agents SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = ?`,
      )
      .run(status, slug);
    if (result.changes === 0) throw agentNotFoundError(slug);
    return this.getAgent(slug);
  }

  async getSigningMaterial(slug: string): Promise<SigningMaterial> {
    const row = this.db
      .prepare("SELECT public_did, encrypted_identity FROM technocore_agents WHERE slug = ?")
      .get(slug) as { public_did: string; encrypted_identity: string } | undefined;
    if (!row) throw agentNotFoundError(slug);
    return { publicDid: row.public_did, encryptedSecretKey: row.encrypted_identity };
  }

  /** Used by the identity:create script and tests to register a newly generated agent identity. */
  createAgent(input: CreateAgentInput): GsgTechnocoreAgent {
    const id = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO technocore_agents
             (id, slug, display_name, public_did, encrypted_identity, allowed_rooms, can_read, can_publish, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.slug,
          input.displayName,
          input.publicDid,
          input.encryptedSecretKey,
          JSON.stringify(input.allowedRooms),
          input.canRead ?? true ? 1 : 0,
          input.canPublish ?? false ? 1 : 0,
          input.status ?? "paused",
        );
    } catch (err) {
      throw agentForbiddenError(`Failed to create agent "${input.slug}": ${(err as Error).message}`);
    }
    return {
      id,
      slug: input.slug,
      displayName: input.displayName,
      publicDid: input.publicDid,
      status: input.status ?? "paused",
      allowedRooms: input.allowedRooms,
      canRead: input.canRead ?? true,
      canPublish: input.canPublish ?? false,
    };
  }
}

/** In-process registry for unit tests only — never used by the running server. */
export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, GsgTechnocoreAgent>();
  private readonly signingMaterial = new Map<string, SigningMaterial>();

  constructor(seed: Array<{ agent: GsgTechnocoreAgent; signing?: SigningMaterial }> = []) {
    for (const { agent, signing } of seed) {
      this.agents.set(agent.slug, agent);
      if (signing) this.signingMaterial.set(agent.slug, signing);
    }
  }

  async getAgent(slug: string): Promise<GsgTechnocoreAgent> {
    const agent = this.agents.get(slug);
    if (!agent) throw agentNotFoundError(slug);
    return agent;
  }

  async listAgents(): Promise<GsgTechnocoreAgent[]> {
    return Array.from(this.agents.values());
  }

  async setStatus(slug: string, status: GsgTechnocoreAgent["status"]): Promise<GsgTechnocoreAgent> {
    const agent = await this.getAgent(slug);
    const updated = { ...agent, status };
    this.agents.set(slug, updated);
    return updated;
  }

  async getSigningMaterial(slug: string): Promise<SigningMaterial> {
    const material = this.signingMaterial.get(slug);
    if (!material) throw agentNotFoundError(slug);
    return material;
  }
}

export function assertAgentCanPublish(agent: GsgTechnocoreAgent, room: string): void {
  if (agent.status !== "active") {
    throw agentInactiveError(agent.slug);
  }
  if (!agent.canPublish) {
    throw agentForbiddenError(`Agent "${agent.slug}" is not permitted to publish.`);
  }
  if (!agent.allowedRooms.includes(room)) {
    throw agentForbiddenError(`Agent "${agent.slug}" is not permitted to publish to room "${room}".`);
  }
}

export function assertAgentCanRead(agent: GsgTechnocoreAgent, room: string): void {
  if (agent.status === "revoked") {
    throw agentInactiveError(agent.slug);
  }
  if (!agent.canRead) {
    throw agentForbiddenError(`Agent "${agent.slug}" is not permitted to read.`);
  }
  if (!agent.allowedRooms.includes(room)) {
    throw agentForbiddenError(`Agent "${agent.slug}" is not permitted to read room "${room}".`);
  }
}
