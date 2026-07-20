import { join } from "node:path";
import { ensureDir } from "../../lib/fs-utils.js";
import type { PipelineStage } from "../definition.js";
import { writeFileSync } from "node:fs";

/**
 * Renders a pipeline stage into Claude Code's two artifact shapes:
 * a skill (for model auto-matching) and an explicit slash command
 * (for predictable, user-typed invocation) — decision #27. Both get
 * the same orchestration body; only the frontmatter/location differs.
 *
 * Skills are deliberately named with a DIFFERENT prefix ("mr-") than the
 * command namespace ("kido:") — Claude Code's `/` picker lists skills by
 * their own folder name alongside commands, so if both shared the "kido"
 * prefix, typing `/kido` would surface both the skill AND the command for
 * every stage (12 near-identical-looking entries instead of 6). Openspec
 * avoids this the same way: `openspec-explore` (skill) vs `opsx:explore`
 * (command) — no shared prefix, no collision.
 */
export function renderClaudeCodeStage(stage: PipelineStage, claudeDir: string): void {
  const skillName = `mr-${stage.id}`;
  const skillDir = join(claudeDir, "skills", skillName);
  ensureDir(skillDir);

  const skillFrontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${stage.description}`,
    `allowed-tools: ${stage.allowedTools}`,
    "---",
    "",
    "",
  ].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), skillFrontmatter + stage.body, "utf8");

  const commandsDir = join(claudeDir, "commands", "kido");
  ensureDir(commandsDir);
  const commandFrontmatter = [
    "---",
    `name: "Kido: ${stage.id}"`,
    `description: ${stage.description}`,
    `allowed-tools: ${stage.allowedTools}`,
    "---",
    "",
    "",
  ].join("\n");
  writeFileSync(join(commandsDir, `${stage.id}.md`), commandFrontmatter + stage.body, "utf8");
}

export function renderAllClaudeCodeStages(stages: PipelineStage[], claudeDir: string): void {
  for (const stage of stages) {
    renderClaudeCodeStage(stage, claudeDir);
  }
}
