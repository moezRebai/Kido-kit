import { mkdirSync, existsSync, readdirSync, renameSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function isEmptyDir(path: string): boolean {
  if (!existsSync(path)) return true;
  return readdirSync(path).length === 0;
}

/** Moves a directory, creating the destination's parent if needed. Throws if src doesn't exist. */
export function moveDir(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`Cannot move: ${src} does not exist`);
  }
  ensureDir(join(dest, ".."));
  renameSync(src, dest);
}

/** Recursively copies a directory's contents into another, creating dest if needed. */
export function copyDirContents(src: string, dest: string): void {
  ensureDir(dest);
  cpSync(src, dest, { recursive: true });
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** kebab-case a free-text title, e.g. "Add Swap Pricing" -> "add-swap-pricing". */
export function kebabCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
