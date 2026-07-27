import type { AgentRenderer } from "./types.js";
import { claudeCodeRenderer } from "./claude-code.js";

export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer];
