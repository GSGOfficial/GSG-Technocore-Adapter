import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { identityError } from "../client/technocore-errors.js";
import { DID_KEY_PATTERN } from "../security/input-validation.js";

/** Multicodec varint prefix for "ed25519-pub" (0xed01, low-byte-first). */
const MULTICODEC_ED25519_PUB = new Uint8Array([0xed, 0x01]);

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeyPair(): Ed25519KeyPair {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function publicKeyToDid(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw identityError(`Ed25519 public key must be 32 bytes, got ${publicKey.length}.`);
  }
  const prefixed = new Uint8Array(MULTICODEC_ED25519_PUB.length + publicKey.length);
  prefixed.set(MULTICODEC_ED25519_PUB, 0);
  prefixed.set(publicKey, MULTICODEC_ED25519_PUB.length);
  const multibase = "z" + bs58.encode(prefixed);
  const did = `did:key:${multibase}`;
  if (!DID_KEY_PATTERN.test(did)) {
    // Should be unreachable for a valid 32-byte key; guards against a
    // future encoding regression silently producing an invalid DID.
    throw identityError(`Derived DID "${did}" does not match the expected did:key shape.`);
  }
  return did;
}

export function didToPublicKey(did: string): Uint8Array {
  if (!DID_KEY_PATTERN.test(did)) {
    throw identityError(`"${did}" is not a well-formed Ed25519 did:key.`);
  }
  const multibase = did.slice("did:key:".length);
  const decoded = bs58.decode(multibase.slice(1)); // drop the 'z' multibase prefix
  const prefix = decoded.subarray(0, 2);
  if (prefix[0] !== MULTICODEC_ED25519_PUB[0] || prefix[1] !== MULTICODEC_ED25519_PUB[1]) {
    throw identityError(`DID "${did}" does not carry the ed25519-pub multicodec prefix.`);
  }
  const publicKey = decoded.subarray(2);
  if (publicKey.length !== 32) {
    throw identityError(`DID "${did}" decodes to a ${publicKey.length}-byte key, expected 32.`);
  }
  return publicKey;
}
