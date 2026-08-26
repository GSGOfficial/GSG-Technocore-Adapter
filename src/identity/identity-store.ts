import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { identityError } from "../client/technocore-errors.js";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function loadEncryptionKey(base64Key: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(base64Key, "base64");
  } catch {
    throw identityError("TECHNOCORE_IDENTITY_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== 32) {
    throw identityError(
      `TECHNOCORE_IDENTITY_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Encrypts a raw Ed25519 secret key with AES-256-GCM. Returns a single
 * self-contained base64 blob (iv || ciphertext || authTag) suitable for
 * storage in Supabase's `encrypted_identity` column or a local file.
 */
export function encryptSecretKey(secretKey: Uint8Array, encryptionKeyBase64: string): string {
  const key = loadEncryptionKey(encryptionKeyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

export function decryptSecretKey(blobBase64: string, encryptionKeyBase64: string): Uint8Array {
  const key = loadEncryptionKey(encryptionKeyBase64);
  const blob = Buffer.from(blobBase64, "base64");
  if (blob.length < IV_LENGTH + 16 + 1) {
    throw identityError("Encrypted identity blob is too short to be valid.");
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(plaintext);
  } catch {
    throw identityError("Failed to decrypt identity: wrong key or corrupted data.");
  }
}

export interface StoredIdentity {
  slug: string;
  publicDid: string;
  encryptedSecretKey: string;
  createdAt: string;
}
