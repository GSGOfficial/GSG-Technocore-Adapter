import { describe, expect, it } from "vitest";
import {
  ROOM_NAME_PATTERN,
  validateRoomName,
  assertAllowedRoom,
  resolveCategoryToRoom,
} from "../../src/security/room-policy.js";
import { isTechnocoreError } from "../../src/client/technocore-errors.js";

describe("ROOM_NAME_PATTERN", () => {
  it("accepts well-formed room names", () => {
    expect(ROOM_NAME_PATTERN.test("gsg-financial")).toBe(true);
    expect(ROOM_NAME_PATTERN.test("p-private_room1")).toBe(true);
    expect(ROOM_NAME_PATTERN.test("a")).toBe(true);
  });

  it("rejects names with path traversal or unsafe characters", () => {
    expect(ROOM_NAME_PATTERN.test("../etc/passwd")).toBe(false);
    expect(ROOM_NAME_PATTERN.test("gsg/financial")).toBe(false);
    expect(ROOM_NAME_PATTERN.test("GSG-Financial")).toBe(false);
    expect(ROOM_NAME_PATTERN.test("")).toBe(false);
    expect(ROOM_NAME_PATTERN.test("a".repeat(49))).toBe(false);
  });
});

describe("validateRoomName", () => {
  it("throws a typed TechnocoreError for an invalid room", () => {
    try {
      validateRoomName("../../secrets");
      expect.fail("should have thrown");
    } catch (err) {
      expect(isTechnocoreError(err)).toBe(true);
      if (isTechnocoreError(err)) expect(err.code).toBe("TECHNOCORE_INVALID_ROOM");
    }
  });
});

describe("assertAllowedRoom", () => {
  const allowlist = ["gsg-financial", "gsg-validation"];

  it("passes for an allowlisted room", () => {
    expect(() => assertAllowedRoom("gsg-financial", allowlist)).not.toThrow();
  });

  it("rejects a syntactically valid room not on the allowlist", () => {
    expect(() => assertAllowedRoom("some-other-room", allowlist)).toThrow();
  });
});

describe("resolveCategoryToRoom", () => {
  const allowlist = ["gsg-financial", "gsg-validation", "gsg-publishing"];

  it("deterministically maps a known category to its room", () => {
    expect(resolveCategoryToRoom("financial", allowlist)).toBe("gsg-financial");
  });

  it("rejects an unknown category rather than letting a model invent a room", () => {
    expect(() => resolveCategoryToRoom("evil-room", allowlist)).toThrow();
  });

  it("rejects a known category whose room is not allowlisted for this deployment", () => {
    expect(() => resolveCategoryToRoom("sports", allowlist)).toThrow();
  });
});
