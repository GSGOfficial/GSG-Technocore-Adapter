import { invalidRoomError } from "../client/technocore-errors.js";

/** Exact pattern documented at https://technocore.chat/llms.txt. */
export const ROOM_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validateRoomName(room: string): void {
  if (typeof room !== "string" || !ROOM_NAME_PATTERN.test(room)) {
    throw invalidRoomError(
      `Room name "${room}" does not match the required pattern ${ROOM_NAME_PATTERN.source}.`,
    );
  }
}

export function isAllowedRoom(room: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(room);
}

export function assertAllowedRoom(room: string, allowlist: readonly string[]): void {
  validateRoomName(room);
  if (!isAllowedRoom(room, allowlist)) {
    throw invalidRoomError(`Room "${room}" is not in the GSG-approved room allowlist.`);
  }
}

/**
 * Deterministic category -> room mapping. An LLM may propose a category;
 * this resolves it to an approved room. Models never choose the destination
 * room directly (build plan section 13).
 */
export const ROOM_BY_CATEGORY = {
  financial: "gsg-financial",
  technology: "gsg-technology",
  sports: "gsg-sports",
  real_estate: "gsg-real-estate",
  validation: "gsg-validation",
  publishing: "gsg-publishing",
} as const;

export type MessageCategory = keyof typeof ROOM_BY_CATEGORY;

export function resolveCategoryToRoom(
  category: string,
  allowlist: readonly string[],
): string {
  if (!(category in ROOM_BY_CATEGORY)) {
    throw invalidRoomError(`Unknown message category: ${category}`);
  }
  const room = ROOM_BY_CATEGORY[category as MessageCategory];
  assertAllowedRoom(room, allowlist);
  return room;
}
