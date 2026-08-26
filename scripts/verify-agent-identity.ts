/**
 * Verifies a stored agent identity end-to-end without ever printing the
 * secret key: signs a throwaway test payload and confirms it verifies, then
 * confirms a tampered payload correctly fails verification.
 *
 * Usage: npm run identity:verify -- --agent gsg-financial-agent
 */
import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/database.js";
import { SqliteAgentRegistry } from "../src/agents/agent-registry.js";
import { decryptSecretKey } from "../src/identity/identity-store.js";
import { signMessage, verifySignature } from "../src/identity/message-signer.js";
import { parseArgs } from "./arg-parser.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const slug = flags.agent;
  if (!slug) fail("--agent <slug> is required.");

  const config = loadConfig();
  if (!config.identityEncryptionKey) fail("TECHNOCORE_IDENTITY_ENCRYPTION_KEY is not set.");

  const db = openDatabase(config.dbPath);
  const registry = new SqliteAgentRegistry(db);

  const signing = await registry.getSigningMaterial(slug).catch(() => null);
  if (!signing) fail(`No identity found for agent "${slug}".`);

  const secretKey = decryptSecretKey(signing.encryptedSecretKey, config.identityEncryptionKey);

  const testRoom = "gsg-validation";
  const testNonce = "1";
  const testText = "identity verification check";

  const signed = signMessage({ secretKey, room: testRoom, nonce: testNonce, text: testText });

  if (signed.did !== signing.publicDid) {
    fail(
      `Derived DID (${signed.did}) does not match the stored public DID (${signing.publicDid}). ` +
        "The stored identity may be corrupted.",
    );
  }

  const validSignatureOk = verifySignature({
    did: signed.did,
    room: testRoom,
    nonce: testNonce,
    text: testText,
    signature: signed.signature,
  });
  if (!validSignatureOk) fail("Signature failed to verify against its own payload. Identity is broken.");

  const tamperedTextOk = verifySignature({
    did: signed.did,
    room: testRoom,
    nonce: testNonce,
    text: testText + " tampered",
    signature: signed.signature,
  });
  if (tamperedTextOk) fail("Tampered text incorrectly verified — signature check is not secure.");

  const tamperedNonceOk = verifySignature({
    did: signed.did,
    room: testRoom,
    nonce: "999999",
    text: testText,
    signature: signed.signature,
  });
  if (tamperedNonceOk) fail("Tampered nonce incorrectly verified — signature check is not secure.");

  const tamperedRoomOk = verifySignature({
    did: signed.did,
    room: "gsg-publishing",
    nonce: testNonce,
    text: testText,
    signature: signed.signature,
  });
  if (tamperedRoomOk) fail("Tampered room incorrectly verified — signature check is not secure.");

  console.log(`Identity OK for agent "${slug}".`);
  console.log(`Public DID: ${signed.did}`);
  console.log("Signature verifies against its own payload; tampered room/nonce/text correctly fail.");

  db.close();
}

main().catch((err) => fail((err as Error).message));
