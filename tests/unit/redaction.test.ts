import { describe, expect, it } from "vitest";
import { containsSecret, detectSecrets } from "../../src/security/redaction.js";

describe("redaction", () => {
  it("flags a PEM private key block", () => {
    expect(containsSecret("-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----")).toBe(true);
  });

  it("flags a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(containsSecret(`token=${jwt}`)).toBe(true);
  });

  it("flags an AWS access key", () => {
    expect(containsSecret("key: AKIAABCDEFGHIJKLMNOP")).toBe(true);
  });

  it("flags a database connection string with embedded credentials", () => {
    expect(containsSecret("postgres://user:hunter2@db.internal:5432/prod")).toBe(true);
  });

  it("flags a 12-word space-separated lowercase phrase (possible seed phrase)", () => {
    const dictionary = [
      "apple",
      "brave",
      "cargo",
      "delta",
      "eagle",
      "flame",
      "grape",
      "haven",
      "ivory",
      "joker",
      "knead",
      "lemon",
    ];
    expect(containsSecret(dictionary.join(" "))).toBe(true);
  });

  it("does not flag ordinary business text", () => {
    expect(containsSecret("Q3 revenue grew 12% year over year on strong demand.")).toBe(false);
  });

  it("reports the matched category without echoing the full secret", () => {
    const matches = detectSecrets("Bearer sk-abcdefghijklmnopqrstuvwx");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.sample.length).toBeLessThan(20);
  });
});
