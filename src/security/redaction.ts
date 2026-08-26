export interface SecretMatch {
  category: string;
  sample: string;
}

interface SecretPattern {
  category: string;
  pattern: RegExp;
}

/**
 * Heuristic secret detection. This is NOT complete protection — regex
 * scanning cannot catch every secret shape. It is a last-line gate before
 * outbound publishing; the primary control is restricting which source
 * fields are allowed into public messages in the first place.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { category: "private_key_block", pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----/ },
  { category: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { category: "authorization_header", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i },
  { category: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { category: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { category: "generic_api_key", pattern: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { category: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    category: "db_connection_string",
    pattern: /\b(postgres|postgresql|mysql|mongodb(\+srv)?):\/\/[^\s]+:[^\s]+@[^\s]+/i,
  },
  { category: "internal_host", pattern: /\b[a-z0-9-]+\.internal\b/i },
  { category: "loopback_or_private_ip", pattern: /\b(127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { category: "email_address", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { category: "phone_number", pattern: /\b(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/ },
];

/**
 * Flags text that looks like a 12- or 24-word BIP39-style seed phrase: a
 * long run of short, space-separated lowercase alphabetic words with no
 * other punctuation. Heuristic only.
 */
function looksLikeSeedPhrase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;
  return words.every((w) => /^[a-z]{3,8}$/.test(w));
}

export function detectSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { category, pattern } of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push({ category, sample: match[0].slice(0, 8) + "…" });
    }
  }
  if (looksLikeSeedPhrase(text)) {
    matches.push({ category: "possible_seed_phrase", sample: "[redacted]" });
  }
  return matches;
}

export function containsSecret(text: string): boolean {
  return detectSecrets(text).length > 0;
}
