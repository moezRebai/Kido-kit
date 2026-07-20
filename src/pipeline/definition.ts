// Agent-agnostic pipeline stage definitions (decision #14). Each stage is
// pure data: a name, description, required tools, and prompt body. Renderers
// (see ./renderers/) turn this into the file format a specific coding agent
// expects (Claude Code today; Gemini CLI/Kilo Code later without touching
// this file).

export interface PipelineStage {
  /** Short id used for the folder/file name, e.g. "study" -> mr-study (skill), /kido:study (command) */
  id: string;
  /** One-line description used for skill auto-matching and command listings. */
  description: string;
  /** Tool allowlist, in Claude Code's `allowed-tools` syntax. */
  allowedTools: string;
  /** Full orchestration instructions (markdown body). */
  body: string;
}

import { studyStage } from "../skills-content/study.js";
import { specStage } from "../skills-content/spec.js";
import { tasksStage } from "../skills-content/tasks.js";
import { applyStage } from "../skills-content/apply.js";
import { reviewStage } from "../skills-content/review.js";
import { archiveStage } from "../skills-content/archive.js";

export const stages: PipelineStage[] = [
  studyStage,
  specStage,
  tasksStage,
  applyStage,
  reviewStage,
  archiveStage,
];
