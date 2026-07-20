import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ChangeType = "feature" | "bug";

export interface ChangeMeta {
  type: ChangeType;
  createdAt: string;
}

const META_FILENAME = ".kido-meta.json";

export function writeChangeMeta(changeDir: string, meta: ChangeMeta): void {
  writeFileSync(join(changeDir, META_FILENAME), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

export function readChangeMeta(changeDir: string): ChangeMeta | undefined {
  const path = join(changeDir, META_FILENAME);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ChangeMeta;
}
