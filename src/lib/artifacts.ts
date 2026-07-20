import type { ChangeType } from "./change-meta.js";

export interface ArtifactSpec {
  id: string;
  filename: string;
  /** Required before the change can be archived. */
  requiredForArchive: boolean;
}

export function artifactsForType(type: ChangeType): ArtifactSpec[] {
  if (type === "bug") {
    return [{ id: "bug", filename: "bug.md", requiredForArchive: true }];
  }
  return [
    { id: "functional-spec", filename: "functional-spec.md", requiredForArchive: false },
    { id: "design", filename: "design.md", requiredForArchive: true },
    { id: "tasks", filename: "tasks.md", requiredForArchive: true },
  ];
}
