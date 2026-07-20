import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { readChangeMeta } from "../lib/change-meta.js";
import { artifactsForType } from "../lib/artifacts.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateChange(repoRoot: string, changeName: string): ValidationResult {
  const paths = resolveKidoPaths(repoRoot);
  const changeDir = paths.changeDir(changeName);

  if (!existsSync(changeDir)) {
    return { ok: false, errors: [`No change named "${changeName}" found at ${changeDir}`] };
  }

  const meta = readChangeMeta(changeDir);
  const type = meta?.type ?? "feature";
  const artifacts = artifactsForType(type);

  const errors: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.requiredForArchive && !existsSync(join(changeDir, artifact.filename))) {
      errors.push(`Missing required artifact: ${artifact.filename}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function runValidate(repoRoot: string, changeName: string): void {
  const result = validateChange(repoRoot, changeName);
  if (result.ok) {
    console.log(`"${changeName}" is valid and ready to archive.`);
  } else {
    console.log(`"${changeName}" is not ready:`);
    for (const error of result.errors) console.log(`  - ${error}`);
    process.exitCode = 1;
  }
}
