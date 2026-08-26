import { resolveCategoryToRoom } from "../security/room-policy.js";
import type { GsgTechnocoreAgent } from "../client/technocore-types.js";
import { assertAgentCanPublish } from "./agent-registry.js";

/**
 * Resolves an LLM-proposed category to a concrete, GSG-allowlisted room and
 * confirms the specific agent is permitted to publish there. This is the
 * single chokepoint models pass through — they choose a category, never a
 * destination room directly (build plan section 13).
 */
export function routeMessage(
  agent: GsgTechnocoreAgent,
  category: string,
  deploymentAllowlist: readonly string[],
): string {
  const room = resolveCategoryToRoom(category, deploymentAllowlist);
  assertAgentCanPublish(agent, room);
  return room;
}
