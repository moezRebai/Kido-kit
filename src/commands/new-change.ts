import { existsSync } from "node:fs";
import { ensureDir, kebabCase } from "../lib/fs-utils.js";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { writeChangeMeta, type ChangeType } from "../lib/change-meta.js";

export function runNewChange(repoRoot: string, rawName: string, type: ChangeType): void {
  const paths = resolveKidoPaths(repoRoot);
  const name = kebabCase(rawName);
  const changeDir = paths.changeDir(name);

  if (existsSync(changeDir)) {
    console.log(`Change "${name}" already exists at ${changeDir}`);
    return;
  }

  ensureDir(changeDir);
  writeChangeMeta(changeDir, { type, createdAt: new Date().toISOString() });

  console.log(`Created ${changeDir} (type: ${type})`);
  if (type === "feature") {
    console.log("Next: /kido:specify to draft functional-spec.md, then design.md.");
  } else {
    console.log("Next: /kido:specify to draft bug.md.");
  }
}
