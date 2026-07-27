import type { AgentRenderer } from "./types.js";
import { claudeCodeRenderer } from "./claude-code.js";
import { geminiCliRenderer } from "./gemini-cli.js";

export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer, geminiCliRenderer];
