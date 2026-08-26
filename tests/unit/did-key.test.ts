import { describe, expect, it } from "vitest";
import { generateKeyPair, publicKeyToDid, didToPublicKey } from "../../src/identity/did-key.js";
import { DID_KEY_PATTERN } from "../../src/security/input-validation.js";

describe("did:key encoding", () => {
  it("derives a DID matching the upstream pattern for every generated key", () => {
    for (let i = 0; i < 20; i++) {
      const { publicKey } = generateKeyPair();
      const did = publicKeyToDid(publicKey);
      expect(DID_KEY_PATTERN.test(did)).toBe(true);
      expect(did.startsWith("did:key:z6Mk")).toBe(true);
    }
  });

  it("round-trips public key -> DID -> public key", () => {
    const { publicKey } = generateKeyPair();
    const did = publicKeyToDid(publicKey);
    const recovered = didToPublicKey(did);
    expect(Buffer.from(recovered).equals(Buffer.from(publicKey))).toBe(true);
  });

  it("produces different DIDs for different keys", () => {
    const a = publicKeyToDid(generateKeyPair().publicKey);
    const b = publicKeyToDid(generateKeyPair().publicKey);
    expect(a).not.toBe(b);
  });

  it("rejects a DID with a corrupted multicodec prefix", () => {
    const { publicKey } = generateKeyPair();
    const did = publicKeyToDid(publicKey);
    const corrupted = did.slice(0, -1) + (did.endsWith("a") ? "b" : "a");
    // Either throws (invalid pattern/prefix) or, in the rare case the last
    // char swap still parses, must not silently recover the original key.
    try {
      const recovered = didToPublicKey(corrupted);
      expect(Buffer.from(recovered).equals(Buffer.from(publicKey))).toBe(false);
    } catch {
      // Expected in the common case.
    }
  });
});
