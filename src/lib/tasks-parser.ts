export interface ParsedTask {
  title: string;
  body: string;
}

/** Parses `tasks.md`'s required `## Task N: <title>` sections (see skills-content/tasks.ts). */
export function parseTasks(content: string): ParsedTask[] {
  const sections = content.split(/^##\s+Task\s+\d+:\s*/m).slice(1);
  const titleLines = [...content.matchAll(/^##\s+Task\s+\d+:\s*(.+)$/gm)].map((m) => m[1]?.trim() ?? "");

  return sections.map((section, i) => {
    const [, ...rest] = section.split("\n");
    return {
      title: titleLines[i] ?? "Untitled task",
      body: rest.join("\n").trim(),
    };
  });
}

/** Extracts a title (first heading or line) and the remaining body from a markdown file. */
export function extractTitleAndBody(content: string): { title: string; body: string } {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((l) => /^#\s+/.test(l));
  if (headingIndex !== -1) {
    const title = lines[headingIndex]!.replace(/^#\s+/, "").trim();
    return { title, body: lines.slice(headingIndex + 1).join("\n").trim() };
  }
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  return {
    title: firstNonEmpty !== -1 ? lines[firstNonEmpty]!.trim() : "Untitled",
    body: content.trim(),
  };
}
