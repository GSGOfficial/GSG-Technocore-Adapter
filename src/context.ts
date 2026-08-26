import type { AdapterConfig } from "./config/env.js";
import { openDatabase, type TechnocoreDatabase } from "./db/database.js";
import { TechnocoreClient, clientOptionsFromConfig } from "./client/technocore-client.js";
import { type AgentRegistry, SqliteAgentRegistry } from "./agents/agent-registry.js";
import { type CursorService, SqliteCursorService } from "./archive/cursor-service.js";
import { ArchiveService } from "./archive/archive-service.js";
import { ContributionService } from "./archive/contribution-service.js";
import { SqlitePublishRequestService } from "./archive/publish-request-service.js";
import { SqliteNonceAllocator, type NonceAllocator } from "./identity/nonce-manager.js";
import { TokenBucketRateLimiter, type RateLimiter } from "./agents/publishing-policy.js";
import { PublishService } from "./agents/publish-service.js";

export interface AdapterContext {
  config: AdapterConfig;
  db: TechnocoreDatabase;
  technocore: TechnocoreClient;
  agents: AgentRegistry;
  cursors: CursorService;
  archive: ArchiveService;
  contributions: ContributionService;
  publishRequests: SqlitePublishRequestService;
  nonces: NonceAllocator;
  rateLimiter: RateLimiter;
  publishService: PublishService | null;
}

export function buildAdapterContext(config: AdapterConfig): AdapterContext {
  const db = openDatabase(config.dbPath);

  const technocore = new TechnocoreClient(clientOptionsFromConfig(config));

  const agents = new SqliteAgentRegistry(db);
  const cursors = new SqliteCursorService(db);
  const archive = new ArchiveService(technocore, db, cursors, config.defaultReadLimit);
  const contributions = new ContributionService(db);
  const publishRequests = new SqlitePublishRequestService(db);
  const nonces = new SqliteNonceAllocator(db);
  const rateLimiter = new TokenBucketRateLimiter(10, 0.5); // 10 burst, 1 token/2s sustained

  const publishService = config.identityEncryptionKey
    ? new PublishService({
        agents,
        technocore,
        nonces,
        rateLimiter,
        publishRequests,
        identityEncryptionKey: config.identityEncryptionKey,
        db,
      })
    : null;

  return {
    config,
    db,
    technocore,
    agents,
    cursors,
    archive,
    contributions,
    publishRequests,
    nonces,
    rateLimiter,
    publishService,
  };
}
