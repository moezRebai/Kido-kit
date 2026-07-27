import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ensureDir } from "../../lib/fs-utils.js";
import type { PipelineStage } from "../definition.js";
import type { AgentRenderer } from "./types.js";

/**
 * Renders a pipeline stage into Kilo Code's command format
 * (.kilo/commands/kido-<id>.md — the format shared by both Kilo Code's VS
 * Code extension and its standalone CLI). Kilo Code has no auto-invoke
 * mechanism for a narrow single-purpose script the way Claude Code/Gemini
 * CLI skills do (its closest analog, custom modes, is a full persona a user
 * switches into — a structural mismatch for a Kido pipeline stage), so this
 * is the only artifact per stage.
 */
export function renderKiloCodeStage(stage: PipelineStage, kiloDir: string): void {
  const commandsDir = join(kiloDir, "commands");
  ensureDir(commandsDir);
  const frontmatter = ["---", `description: ${stage.description}`, "---", "", ""].join("\n");
  writeFileSync(join(commandsDir, `kido-${stage.id}.md`), frontmatter + stage.body, "utf8");
}

export function renderAllKiloCodeStages(stages: PipelineStage[], kiloDir: string): void {
  for (const stage of stages) {
    renderKiloCodeStage(stage, kiloDir);
  }
}

export const kiloCodeRenderer: AgentRenderer = {
  id: "kilo",
  label: "Kilo Code",
  render(stages, repoRoot) {
    const kiloDir = join(repoRoot, ".kilo");
    renderAllKiloCodeStages(stages, kiloDir);
    return stages.map((stage) => join(kiloDir, "commands", `kido-${stage.id}.md`));
  },
};
