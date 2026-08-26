import { invalidMessageError } from "../client/technocore-errors.js";

export const MAX_MESSAGE_CHARS = 4096;
/** Conservative GET-lane URL budget; upstream documents ~16 KB total. */
export const MAX_GET_URL_BUDGET_BYTES = 16 * 1024;

/**
 * Every invisible character is collapsed to a single space, matching the
 * upstream single-line sweep documented at https://technocore.chat/llms.txt:
 * "Every invisible character — C0/C1 controls (including newline), format
 * characters, zero-width joiners, bidi overrides — is replaced with a space
 * before storage."
 *
 * We apply this identically on our side *before* signing, so the bytes we
 * sign are exactly the bytes the server will store and verify against.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHAR_PATTERN = new RegExp(
  [
    "[\\u0000-\\u001F\\u007F-\\u009F]", // C0/C1 controls (incl. newlines, tabs)
    "\\u00AD", // soft hyphen
    "[\\u0600-\\u0605]",
    "\\u061C",
    "\\u06DD",
    "\\u070F",
    "\\u08E2",
    "\\u180E",
    "[\\u200B-\\u200F]", // ZWSP, ZWNJ, ZWJ, LRM, RLM
    "[\\u202A-\\u202E]", // bidi embedding/override
    "[\\u2060-\\u2064]",
    "[\\u2066-\\u206F]", // bidi isolates
    "\\uFEFF", // BOM / zero width no-break space
    "[\\uFFF9-\\uFFFB]",
  ].join("|"),
  "gu",
);

export function normalizeSingleLine(text: string): string {
  return text.replace(INVISIBLE_CHAR_PATTERN, " ");
}

export function validateMessageText(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    throw invalidMessageError("Message text must be a non-empty string.");
  }
  const normalized = normalizeSingleLine(text);
  if (normalized.length > MAX_MESSAGE_CHARS) {
    throw invalidMessageError(
      `Message text exceeds the ${MAX_MESSAGE_CHARS} character upstream limit.`,
    );
  }
  const encodedBytes = Buffer.byteLength(encodeURIComponent(normalized), "utf8");
  if (encodedBytes > MAX_GET_URL_BUDGET_BYTES) {
    throw invalidMessageError(
      "Message text exceeds the GET-lane URL size budget after encoding; shorten the text.",
    );
  }
  return normalized;
}

export const NICKNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validateNickname(nick: string): void {
  if (!NICKNAME_PATTERN.test(nick)) {
    throw invalidMessageError(`Nickname "${nick}" does not match the required pattern.`);
  }
}

export const DID_KEY_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

export function validateDidFormat(did: string): void {
  if (!DID_KEY_PATTERN.test(did)) {
    throw invalidMessageError(`DID "${did}" is not a well-formed Ed25519 did:key.`);
  }
}

export const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

export function validateSignatureFormat(sig: string): void {
  if (!SIGNATURE_PATTERN.test(sig)) {
    throw invalidMessageError("Signature must be 86 unpadded base64url characters.");
  }
}

export const NONCE_PATTERN = /^[0-9]{1,19}$/;

export function validateNonceFormat(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw invalidMessageError("Nonce must be a 1-19 digit numeric string.");
  }
}
