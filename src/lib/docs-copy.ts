import { existsSync } from "node:fs";
import { copyDirContents } from "./fs-utils.js";
import { resolveKidoPaths } from "./kido-paths.js";

/**
 * Copies one repo's kido/docs/* into another's, as a literal seed
 * (decision #50's first half — the second half, re-running /kido:specify
 * seeded with this copy, happens in the skill layer, not here).
 */
export function copyKidoDocs(fromRepoRoot: string, toRepoRoot: string): { copied: boolean; reason?: string } {
  const from = resolveKidoPaths(fromRepoRoot);
  const to = resolveKidoPaths(toRepoRoot);

  if (!existsSync(from.docsDir)) {
    return { copied: false, reason: `No kido/docs/ found at ${fromRepoRoot}` };
  }

  copyDirContents(from.docsDir, to.docsDir);
  return { copied: true };
}
