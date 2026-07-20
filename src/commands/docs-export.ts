import { existsSync } from "node:fs";
import { copyKidoDocs } from "../lib/docs-copy.js";

export function runDocsExport(repoRoot: string, targetPath: string): void {
  if (!existsSync(targetPath)) {
    console.log(`Target path does not exist: ${targetPath}`);
    process.exitCode = 1;
    return;
  }

  const result = copyKidoDocs(repoRoot, targetPath);
  if (result.copied) {
    console.log(`Copied kido/docs/ into ${targetPath}. Run /kido:study there next (regeneration mode) to adapt it.`);
  } else {
    console.log(`Nothing to export: ${result.reason}`);
    process.exitCode = 1;
  }
}
