import type { PipelineStage } from "../definition.js";

export type AgentId = "claude" | "gemini" | "kilo";

export interface AgentRenderer {
  id: AgentId;
  label: string;
  /** Renders every stage for this agent into repoRoot; returns the generated file paths. */
  render(stages: PipelineStage[], repoRoot: string): string[];
}
