import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

/** Walks up from cwd looking for a kido/ folder (or a .git root as a fallback anchor). */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "kido")) || existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir; // hit filesystem root, give up, use cwd
    dir = parent;
  }
}

export interface KidoPaths {
  root: string;
  kidoDir: string;
  docsDir: string;
  changesDir: string;
  archiveDir: string;
  projectName: string;
  functionalDocsPath: string;
  technicalDocsPath: string;
  changeDir: (name: string) => string;
  archivedChangeDir: (name: string) => string;
}

export function resolveKidoPaths(repoRoot: string): KidoPaths {
  const kidoDir = join(repoRoot, "kido");
  const docsDir = join(kidoDir, "docs");
  const changesDir = join(kidoDir, "changes");
  const archiveDir = join(changesDir, "archive");
  const projectName = basename(repoRoot);

  return {
    root: repoRoot,
    kidoDir,
    docsDir,
    changesDir,
    archiveDir,
    projectName,
    functionalDocsPath: join(docsDir, `${projectName}-functional-docs.md`),
    technicalDocsPath: join(docsDir, `${projectName}-technical-docs.md`),
    changeDir: (name: string) => join(changesDir, name),
    archivedChangeDir: (name: string) => join(archiveDir, name),
  };
}
