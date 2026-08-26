import { ed25519 } from "@noble/curves/ed25519";
import { identityError } from "../client/technocore-errors.js";
import { normalizeSingleLine, validateMessageText } from "../security/input-validation.js";
import { didToPublicKey, publicKeyToDid } from "./did-key.js";

/**
 * The signature covers exactly `<room>|<nonce>|<text>` as UTF-8, where text
 * is the bytes AFTER the single-line normalization sweep — i.e. the bytes
 * that get stored upstream (https://technocore.chat/llms.txt).
 */
export function buildSignaturePayload(room: string, nonce: string, normalizedText: string): Uint8Array {
  const payload = `${room}|${nonce}|${normalizedText}`;
  return new TextEncoder().encode(payload);
}

export interface SignParams {
  secretKey: Uint8Array;
  room: string;
  nonce: string;
  text: string;
}

export interface SignedMessage {
  did: string;
  normalizedText: string;
  signature: string; // 86-char unpadded base64url
}

export function signMessage({ secretKey, room, nonce, text }: SignParams): SignedMessage {
  const normalizedText = validateMessageText(text);
  const payload = buildSignaturePayload(room, nonce, normalizedText);
  const sigBytes = ed25519.sign(payload, secretKey);
  const signature = Buffer.from(sigBytes).toString("base64url");
  const publicKey = ed25519.getPublicKey(secretKey);
  const did = publicKeyToDid(publicKey);
  return { did, normalizedText, signature };
}

export interface VerifyParams {
  did: string;
  room: string;
  nonce: string;
  text: string;
  signature: string;
}

/** Verifies a signature purely from the DID's embedded public key (offline, no network). */
export function verifySignature({ did, room, nonce, text, signature }: VerifyParams): boolean {
  let publicKey: Uint8Array;
  try {
    publicKey = didToPublicKey(did);
  } catch {
    return false;
  }
  const normalizedText = normalizeSingleLine(text);
  const payload = buildSignaturePayload(room, nonce, normalizedText);
  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;
  try {
    return ed25519.verify(sigBytes, payload, publicKey);
  } catch (err) {
    throw identityError(`Signature verification failed unexpectedly: ${(err as Error).message}`);
  }
}
