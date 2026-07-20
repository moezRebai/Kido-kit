import { moveDir } from "../lib/fs-utils.js";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { validateChange } from "./validate.js";

export function runArchive(repoRoot: string, changeName: string, force: boolean): void {
  const result = validateChange(repoRoot, changeName);
  if (!result.ok && !force) {
    console.log(`Cannot archive "${changeName}" — not ready:`);
    for (const error of result.errors) console.log(`  - ${error}`);
    console.log("(use --force to archive anyway)");
    process.exitCode = 1;
    return;
  }

  const paths = resolveKidoPaths(repoRoot);
  moveDir(paths.changeDir(changeName), paths.archivedChangeDir(changeName));
  console.log(`Archived "${changeName}" to ${paths.archivedChangeDir(changeName)}`);
}
