import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { resolveKidoPaths } from "../src/lib/kido-paths.js";

function makeEmptyRepo(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-init-"));
}

test("kido init scaffolds kido/docs, kido/changes, kido/changes/archive, and .claude skills+commands", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true });
    const paths = resolveKidoPaths(repo);

    assert.equal(existsSync(paths.docsDir), true);
    assert.equal(existsSync(paths.changesDir), true);
    assert.equal(existsSync(paths.archiveDir), true);

    const skillDirs = readdirSync(join(repo, ".claude", "skills"));
    // Deliberately a different prefix than the /kido:* commands below — see
    // claude-code.ts's renderer doc comment for why (picker-collision fix).
    assert.deepEqual(
      skillDirs.sort(),
      ["mr-apply", "mr-archive", "mr-continue", "mr-document", "mr-review", "mr-specify", "mr-tasks"].sort()
    );

    const commandFiles = readdirSync(join(repo, ".claude", "commands", "kido"));
    assert.deepEqual(
      commandFiles.sort(),
      ["apply.md", "archive.md", "continue.md", "document.md", "review.md", "specify.md", "tasks.md"].sort()
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--no-legacy skips seeding without touching docs/", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true });
    const paths = resolveKidoPaths(repo);
    assert.deepEqual(readdirSync(paths.docsDir), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--from-legacy <path> seeds docs/ from another repo's kido/docs, preserving its filenames as-is", async () => {
  const legacyRepo = makeEmptyRepo();
  const newRepo = makeEmptyRepo();
  try {
    const legacyPaths = resolveKidoPaths(legacyRepo);
    mkdirSync(legacyPaths.docsDir, { recursive: true });
    writeFileSync(legacyPaths.functionalDocsPath, "# legacy functional docs");
    writeFileSync(legacyPaths.technicalDocsPath, "# legacy technical docs");

    await runInit(newRepo, { fromLegacy: legacyRepo });

    const newPaths = resolveKidoPaths(newRepo);
    const copiedFiles = readdirSync(newPaths.docsDir);
    // Seeded files keep the LEGACY project's own names — /kido:specify's seeded
    // interview is what later re-emits them under the new project's naming (decision #50).
    assert.ok(copiedFiles.some((f) => f.includes("functional-docs")));
    assert.ok(copiedFiles.some((f) => f.includes("technical-docs")));
  } finally {
    rmSync(legacyRepo, { recursive: true, force: true });
    rmSync(newRepo, { recursive: true, force: true });
  }
});

test("--from-legacy with a non-existent path warns instead of throwing", async () => {
  const repo = makeEmptyRepo();
  try {
    // Should not throw — just warn and leave docs/ empty.
    await runInit(repo, { fromLegacy: join(repo, "does-not-exist") });
    const paths = resolveKidoPaths(repo);
    assert.deepEqual(readdirSync(paths.docsDir), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("re-running init on a repo that already has docs/ content is a no-op for the legacy question", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true });
    const paths = resolveKidoPaths(repo);
    writeFileSync(paths.functionalDocsPath, "# already studied");

    // No options at all — since docs/ isn't empty, it should return early
    // rather than trying to prompt (which would hang/misbehave without a TTY).
    await runInit(repo);

    assert.equal(readdirSync(paths.docsDir).length, 1, "should not have added or removed anything");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
