import type { AgentId } from "../pipeline/renderers/types.js";
import { AGENT_RENDERERS } from "../pipeline/renderers/registry.js";

const KNOWN_AGENT_IDS: AgentId[] = AGENT_RENDERERS.map((r) => r.id);

/** Parses --agents's value ("claude,gemini" or "all") into validated AgentIds. */
export function parseAgentsFlag(value: string): AgentId[] {
  if (value.trim().toLowerCase() === "all") {
    return [...KNOWN_AGENT_IDS];
  }

  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (ids.length === 0) {
    throw new Error(`--agents requires at least one id (${KNOWN_AGENT_IDS.join(", ")}) or "all"`);
  }

  for (const id of ids) {
    if (!KNOWN_AGENT_IDS.includes(id as AgentId)) {
      throw new Error(`Unknown agent "${id}" in --agents — valid ids: ${KNOWN_AGENT_IDS.join(", ")}, or "all"`);
    }
  }

  return ids as AgentId[];
}
