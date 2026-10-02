import { z } from "zod";

const KNOWN_UPSTREAM_HOST = "technocore.chat";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Loopback by default: the read routes are unauthenticated, so the
  // adapter must not be reachable from outside the host unless an operator
  // deliberately opts in.
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),

  TECHNOCORE_BASE_URL: z.string().url().default(`https://${KNOWN_UPSTREAM_HOST}`),
  TECHNOCORE_DEFAULT_READ_LIMIT: z.coerce.number().int().min(1).max(200).default(50),
  TECHNOCORE_LONG_POLL_SECONDS: z.coerce.number().min(0).max(10).default(0),
  TECHNOCORE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  TECHNOCORE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  TECHNOCORE_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(1024 * 1024),
  TECHNOCORE_ALLOW_UNSIGNED_DEV: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),

  TECHNOCORE_DB_PATH: z.string().default("./data/technocore.db"),

  GSG_TECHNOCORE_API_KEY: z.string().optional().or(z.literal("")),
  GSG_ALLOWED_ROOMS: z.string().default(""),

  TECHNOCORE_IDENTITY_ENCRYPTION_KEY: z.string().optional().or(z.literal("")),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

export interface AdapterConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  technocoreBaseUrl: string;
  defaultReadLimit: number;
  longPollSeconds: number;
  requestTimeoutMs: number;
  maxRetries: number;
  maxResponseBytes: number;
  allowUnsignedDev: boolean;
  dbPath: string;
  gsgApiKey: string | null;
  allowedRooms: string[];
  identityEncryptionKey: string | null;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function assertSafeUpstreamOrigin(url: string, nodeEnv: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigurationError(`TECHNOCORE_BASE_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && !(nodeEnv !== "production" && parsed.protocol === "http:")) {
    throw new ConfigurationError("TECHNOCORE_BASE_URL must use https in production.");
  }
  if (nodeEnv === "production" && parsed.hostname !== KNOWN_UPSTREAM_HOST) {
    throw new ConfigurationError(
      `TECHNOCORE_BASE_URL must be the allowlisted upstream host (${KNOWN_UPSTREAM_HOST}) in production.`,
    );
  }
}

/**
 * Parses and validates process.env into a typed AdapterConfig. Throws
 * ConfigurationError at startup when mandatory production config is missing,
 * per the build plan's fail-fast requirement.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const parsed = rawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const env = parsed.data;

  assertSafeUpstreamOrigin(env.TECHNOCORE_BASE_URL, env.NODE_ENV);

  const allowedRooms = env.GSG_ALLOWED_ROOMS.split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const config: AdapterConfig = {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    technocoreBaseUrl: env.TECHNOCORE_BASE_URL.replace(/\/+$/, ""),
    defaultReadLimit: env.TECHNOCORE_DEFAULT_READ_LIMIT,
    longPollSeconds: env.TECHNOCORE_LONG_POLL_SECONDS,
    requestTimeoutMs: env.TECHNOCORE_REQUEST_TIMEOUT_MS,
    maxRetries: env.TECHNOCORE_MAX_RETRIES,
    maxResponseBytes: env.TECHNOCORE_MAX_RESPONSE_BYTES,
    allowUnsignedDev: env.TECHNOCORE_ALLOW_UNSIGNED_DEV,
    dbPath: env.TECHNOCORE_DB_PATH,
    gsgApiKey: env.GSG_TECHNOCORE_API_KEY || null,
    allowedRooms,
    identityEncryptionKey: env.TECHNOCORE_IDENTITY_ENCRYPTION_KEY || null,
  };

  if (env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!config.gsgApiKey) missing.push("GSG_TECHNOCORE_API_KEY");
    if (!config.identityEncryptionKey) missing.push("TECHNOCORE_IDENTITY_ENCRYPTION_KEY");
    if (config.allowedRooms.length === 0) missing.push("GSG_ALLOWED_ROOMS");
    if (config.allowUnsignedDev) missing.push("TECHNOCORE_ALLOW_UNSIGNED_DEV (must be false)");
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Missing or invalid mandatory production configuration: ${missing.join(", ")}`,
      );
    }
  }

  return config;
}
