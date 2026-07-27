import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ensureDir } from "../../lib/fs-utils.js";
import type { PipelineStage } from "../definition.js";
import type { AgentRenderer } from "./types.js";

/**
 * Renders a pipeline stage into Gemini CLI's two artifact shapes: a skill
 * (.gemini/skills/mr-<id>/SKILL.md, auto-activated via Gemini CLI's native
 * Agent Skills system — built on the same open standard Claude Code's
 * skills use, including the allowed-tools frontmatter field) and an
 * explicit TOML command (.gemini/commands/kido/<id>.toml, namespaced the
 * same way Claude Code's commands are: "/kido:<id>").
 */
export function renderGeminiCliStage(stage: PipelineStage, geminiDir: string): void {
  const skillName = `mr-${stage.id}`;
  const skillDir = join(geminiDir, "skills", skillName);
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

  const commandsDir = join(geminiDir, "commands", "kido");
  ensureDir(commandsDir);
  // TOML literal multi-line strings ('''...''') don't process escapes, so the
  // raw markdown body (quotes, backticks, code fences) can be embedded as-is.
  const toml = [`description = ${JSON.stringify(stage.description)}`, `prompt = '''`, stage.body, `'''`, ""].join(
    "\n"
  );
  writeFileSync(join(commandsDir, `${stage.id}.toml`), toml, "utf8");
}

export function renderAllGeminiCliStages(stages: PipelineStage[], geminiDir: string): void {
  for (const stage of stages) {
    renderGeminiCliStage(stage, geminiDir);
  }
}

export const geminiCliRenderer: AgentRenderer = {
  id: "gemini",
  label: "Gemini CLI",
  render(stages, repoRoot) {
    const geminiDir = join(repoRoot, ".gemini");
    renderAllGeminiCliStages(stages, geminiDir);
    const generated: string[] = [];
    for (const stage of stages) {
      generated.push(join(geminiDir, "skills", `mr-${stage.id}`, "SKILL.md"));
      generated.push(join(geminiDir, "commands", "kido", `${stage.id}.toml`));
    }
    return generated;
  },
};
