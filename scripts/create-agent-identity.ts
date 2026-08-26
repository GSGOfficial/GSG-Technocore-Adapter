/**
 * Creates a new GSG agent identity: generates an Ed25519 keypair, derives
 * its did:key, encrypts the secret key, and stores it in the local SQLite
 * database. Prints only the public DID unless --export-secure is passed.
 *
 * Usage:
 *   npm run identity:create -- --agent gsg-financial-agent \
 *     --display-name "GSG Financial Agent" --rooms gsg-financial,gsg-validation
 *
 *   npm run identity:create -- --agent gsg-financial-agent ... --export-secure
 */
import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/database.js";
import { SqliteAgentRegistry } from "../src/agents/agent-registry.js";
import { generateKeyPair, publicKeyToDid } from "../src/identity/did-key.js";
import { encryptSecretKey } from "../src/identity/identity-store.js";
import { parseArgs } from "./arg-parser.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { flags, booleans } = parseArgs(process.argv.slice(2));
  const slug = flags.agent;
  if (!slug) fail("--agent <slug> is required.");

  const config = loadConfig();
  if (!config.identityEncryptionKey) {
    fail(
      "TECHNOCORE_IDENTITY_ENCRYPTION_KEY is not set. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
        "and set it in your environment before creating identities.",
    );
  }

  const db = openDatabase(config.dbPath);
  const registry = new SqliteAgentRegistry(db);

  const existing = await registry.getAgent(slug).catch(() => null);
  if (existing) {
    fail(`Agent "${slug}" already has an identity. Refusing to overwrite.`);
  }

  const displayName = flags["display-name"] ?? slug;
  const allowedRooms = (flags.rooms ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const canPublish = booleans.has("can-publish");

  const { publicKey, secretKey } = generateKeyPair();
  const publicDid = publicKeyToDid(publicKey);
  const encryptedSecretKey = encryptSecretKey(secretKey, config.identityEncryptionKey);

  registry.createAgent({
    slug,
    displayName,
    publicDid,
    encryptedSecretKey,
    allowedRooms,
    canRead: true,
    canPublish,
    status: "paused",
  });

  console.log(`Identity created for agent "${slug}".`);
  console.log(`Public DID: ${publicDid}`);
  console.log(`Status: paused (activate explicitly via PATCH /api/technocore/agents/${slug}/status)`);
  console.log(`Allowed rooms: ${allowedRooms.join(", ") || "(none — set with --rooms)"}`);
  console.log("");
  console.log(
    "Backup instructions: the encrypted secret key lives in the SQLite database at " +
      `${config.dbPath}, encrypted with TECHNOCORE_IDENTITY_ENCRYPTION_KEY. Back up BOTH the ` +
      "database file and the encryption key (in a secret manager, never together in the same " +
      "place) — losing the key makes the identity unrecoverable.",
  );

  if (booleans.has("export-secure")) {
    console.log("");
    console.log("--export-secure passed. Raw secret key material follows — handle with extreme care:");
    console.log(`  Secret key (base64): ${Buffer.from(secretKey).toString("base64")}`);
    console.log("Store this offline (e.g. a password manager or hardware token). Never commit it,");
    console.log("paste it into chat, or store it alongside the encryption key.");
  }

  db.close();
}

main().catch((err) => fail((err as Error).message));
