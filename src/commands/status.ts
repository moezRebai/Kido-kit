import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { readChangeMeta } from "../lib/change-meta.js";
import { artifactsForType } from "../lib/artifacts.js";

export function runStatus(repoRoot: string, changeName: string): void {
  const paths = resolveKidoPaths(repoRoot);
  const changeDir = paths.changeDir(changeName);

  if (!existsSync(changeDir)) {
    console.log(`No change named "${changeName}" found at ${changeDir}`);
    return;
  }

  const meta = readChangeMeta(changeDir);
  const type = meta?.type ?? "feature";
  console.log(`Change: ${changeName} (type: ${type})`);

  const artifacts = artifactsForType(type);
  for (const artifact of artifacts) {
    const present = existsSync(join(changeDir, artifact.filename));
    const flag = present ? "done" : artifact.requiredForArchive ? "MISSING (required)" : "not started (optional)";
    console.log(`  ${artifact.filename}: ${flag}`);
  }

  const allRequiredDone = artifacts
    .filter((a) => a.requiredForArchive)
    .every((a) => existsSync(join(changeDir, a.filename)));
  console.log(allRequiredDone ? "Ready to archive." : "Not ready to archive yet.");
}
