import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../../src/identity/did-key.js";
import { buildSignaturePayload, signMessage, verifySignature } from "../../src/identity/message-signer.js";

describe("buildSignaturePayload", () => {
  it("builds exactly <room>|<nonce>|<text> as UTF-8", () => {
    const payload = buildSignaturePayload("gsg-financial", "42", "hello world");
    expect(new TextDecoder().decode(payload)).toBe("gsg-financial|42|hello world");
  });
});

describe("signMessage / verifySignature", () => {
  const { secretKey } = generateKeyPair();

  it("produces an 86-character unpadded base64url signature", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    expect(signed.signature).toHaveLength(86);
    expect(signed.signature).not.toMatch(/[+/=]/);
  });

  it("verifies a freshly signed message", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    const ok = verifySignature({
      did: signed.did,
      room: "gsg-financial",
      nonce: "1",
      text: "hello",
      signature: signed.signature,
    });
    expect(ok).toBe(true);
  });

  it("fails verification when the room is changed", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    const ok = verifySignature({
      did: signed.did,
      room: "gsg-publishing",
      nonce: "1",
      text: "hello",
      signature: signed.signature,
    });
    expect(ok).toBe(false);
  });

  it("fails verification when the nonce is changed", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    const ok = verifySignature({
      did: signed.did,
      room: "gsg-financial",
      nonce: "2",
      text: "hello",
      signature: signed.signature,
    });
    expect(ok).toBe(false);
  });

  it("fails verification when the text is changed", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    const ok = verifySignature({
      did: signed.did,
      room: "gsg-financial",
      nonce: "1",
      text: "goodbye",
      signature: signed.signature,
    });
    expect(ok).toBe(false);
  });

  it("fails verification against a different key's DID", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "1", text: "hello" });
    const other = generateKeyPair();
    const otherSigned = signMessage({
      secretKey: other.secretKey,
      room: "gsg-financial",
      nonce: "1",
      text: "hello",
    });
    const ok = verifySignature({
      did: otherSigned.did,
      room: "gsg-financial",
      nonce: "1",
      text: "hello",
      signature: signed.signature,
    });
    expect(ok).toBe(false);
  });

  it("normalizes text identically on sign and verify (newline in raw input)", () => {
    const signed = signMessage({ secretKey, room: "gsg-financial", nonce: "5", text: "line one\nline two" });
    const ok = verifySignature({
      did: signed.did,
      room: "gsg-financial",
      nonce: "5",
      text: "line one\nline two", // raw, unnormalized — verify normalizes internally
      signature: signed.signature,
    });
    expect(ok).toBe(true);
    expect(signed.normalizedText).toBe("line one line two");
  });
});
