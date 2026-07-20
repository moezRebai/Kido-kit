import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir, isEmptyDir, moveDir, copyDirContents, kebabCase } from "../src/lib/fs-utils.js";

test("kebabCase turns free text into a kebab-case slug", () => {
  assert.equal(kebabCase("Add Swap Pricing"), "add-swap-pricing");
  assert.equal(kebabCase("  Fix   Login Bug!! "), "fix-login-bug");
  assert.equal(kebabCase("already-kebab"), "already-kebab");
});

test("ensureDir creates nested directories, isEmptyDir reports correctly", () => {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-"));
  try {
    const nested = join(dir, "a", "b", "c");
    assert.equal(isEmptyDir(nested), true, "a non-existent dir counts as empty");
    ensureDir(nested);
    assert.equal(existsSync(nested), true);
    assert.equal(isEmptyDir(nested), true);
    writeFileSync(join(nested, "file.txt"), "hi");
    assert.equal(isEmptyDir(nested), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("moveDir relocates a directory and its contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-"));
  try {
    const src = join(dir, "src-dir");
    const dest = join(dir, "nested", "dest-dir");
    ensureDir(src);
    writeFileSync(join(src, "file.txt"), "content");

    moveDir(src, dest);

    assert.equal(existsSync(src), false);
    assert.equal(existsSync(join(dest, "file.txt")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("moveDir throws when the source doesn't exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-"));
  try {
    assert.throws(() => moveDir(join(dir, "nope"), join(dir, "dest")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copyDirContents copies files without removing the source", () => {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-"));
  try {
    const src = join(dir, "src-dir");
    const dest = join(dir, "dest-dir");
    ensureDir(src);
    writeFileSync(join(src, "a.md"), "a");

    copyDirContents(src, dest);

    assert.equal(existsSync(join(src, "a.md")), true);
    assert.equal(existsSync(join(dest, "a.md")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
