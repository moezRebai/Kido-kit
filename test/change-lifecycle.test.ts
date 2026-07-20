import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKidoPaths, findRepoRoot } from "../src/lib/kido-paths.js";
import { runNewChange } from "../src/commands/new-change.js";
import { validateChange } from "../src/commands/validate.js";
import { runArchive } from "../src/commands/archive.js";
import { readChangeMeta } from "../src/lib/change-meta.js";
import { copyKidoDocs } from "../src/lib/docs-copy.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-repo-"));
  const paths = resolveKidoPaths(dir);
  mkdirSync(paths.docsDir, { recursive: true });
  mkdirSync(paths.changesDir, { recursive: true });
  mkdirSync(paths.archiveDir, { recursive: true });
  return dir;
}

test("resolveKidoPaths derives project name from the repo folder name", () => {
  const paths = resolveKidoPaths(join("C:", "Solutions", "SomeProject"));
  assert.match(paths.functionalDocsPath, /SomeProject-functional-docs\.md$/);
  assert.match(paths.technicalDocsPath, /SomeProject-technical-docs\.md$/);
});

test("findRepoRoot walks up to a directory containing kido/", () => {
  const repo = makeRepo();
  try {
    const nested = join(repo, "some", "nested", "dir");
    mkdirSync(nested, { recursive: true });
    assert.equal(findRepoRoot(nested), repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("full feature lifecycle: new-change -> incomplete validate fails -> artifacts added -> validate passes -> archive moves the folder", () => {
  const repo = makeRepo();
  try {
    runNewChange(repo, "Add Swap Pricing", "feature");
    const paths = resolveKidoPaths(repo);
    const changeDir = paths.changeDir("add-swap-pricing");
    assert.equal(existsSync(changeDir), true);
    assert.equal(readChangeMeta(changeDir)?.type, "feature");

    let result = validateChange(repo, "add-swap-pricing");
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["Missing required artifact: design.md", "Missing required artifact: tasks.md"]);

    writeFileSync(join(changeDir, "design.md"), "# Design\n\ndetails");
    writeFileSync(join(changeDir, "tasks.md"), "## Task 1: Do the thing\n\nbody");

    result = validateChange(repo, "add-swap-pricing");
    assert.equal(result.ok, true);

    runArchive(repo, "add-swap-pricing", false);
    assert.equal(existsSync(changeDir), false);
    assert.equal(existsSync(paths.archivedChangeDir("add-swap-pricing")), true);
    assert.equal(existsSync(join(paths.archivedChangeDir("add-swap-pricing"), "tasks.md")), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("bug lifecycle only requires bug.md, not design/tasks", () => {
  const repo = makeRepo();
  try {
    runNewChange(repo, "Fix Login Crash", "bug");
    const paths = resolveKidoPaths(repo);
    const changeDir = paths.changeDir("fix-login-crash");

    let result = validateChange(repo, "fix-login-crash");
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["Missing required artifact: bug.md"]);

    writeFileSync(join(changeDir, "bug.md"), "# Login crashes on empty password\n\nrepro steps...");
    result = validateChange(repo, "fix-login-crash");
    assert.equal(result.ok, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("archive refuses an invalid change unless --force is passed", () => {
  const repo = makeRepo();
  try {
    runNewChange(repo, "Incomplete Thing", "feature");
    const paths = resolveKidoPaths(repo);

    runArchive(repo, "incomplete-thing", false);
    assert.equal(existsSync(paths.changeDir("incomplete-thing")), true, "should NOT have moved without --force");
    process.exitCode = 0; // runArchive sets this for CLI purposes; reset so it doesn't leak into the test run's exit status

    runArchive(repo, "incomplete-thing", true);
    assert.equal(existsSync(paths.changeDir("incomplete-thing")), false, "should move with --force");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("copyKidoDocs seeds a target repo's docs/ from a source repo's", () => {
  const source = makeRepo();
  const target = makeRepo();
  try {
    const sourcePaths = resolveKidoPaths(source);
    writeFileSync(sourcePaths.functionalDocsPath, "# Legacy functional docs");
    writeFileSync(sourcePaths.technicalDocsPath, "# Legacy technical docs");

    const result = copyKidoDocs(source, target);
    assert.equal(result.copied, true);

    const copiedFiles = readdirSync(resolveKidoPaths(target).docsDir);
    assert.ok(copiedFiles.length >= 2);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test("copyKidoDocs reports failure when the source has no docs/", () => {
  const source = mkdtempSync(join(tmpdir(), "kido-test-nodocs-"));
  const target = makeRepo();
  try {
    const result = copyKidoDocs(source, target);
    assert.equal(result.copied, false);
    assert.match(result.reason ?? "", /No kido\/docs\/ found/);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
