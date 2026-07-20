// Minimal YAML-frontmatter subset parser/writer — deliberately not a
// dependency (js-yaml) since our frontmatter is always flat string/boolean
// key-value pairs (jiraId, type, status, ...), never nested structures.

export interface Frontmatter {
  [key: string]: string | boolean;
}

export interface ParsedDocument {
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER_DELIMITER = "---";

export function parseFrontmatter(content: string): ParsedDocument {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== FRONTMATTER_DELIMITER) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = lines.indexOf(FRONTMATTER_DELIMITER, 1);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Frontmatter = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key) continue;
    const value = (rawValue ?? "").trim();
    if (value === "true" || value === "false") {
      frontmatter[key] = value === "true";
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  const body = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");
  return { frontmatter, body };
}

export function stringifyDocument(doc: ParsedDocument): string {
  const keys = Object.keys(doc.frontmatter);
  if (keys.length === 0) return doc.body;

  const fmLines = keys.map((key) => {
    const value = doc.frontmatter[key] ?? "";
    if (typeof value === "boolean") return `${key}: ${value}`;
    const needsQuotes = /[:#]/.test(value);
    return `${key}: ${needsQuotes ? `"${value}"` : value}`;
  });

  return [FRONTMATTER_DELIMITER, ...fmLines, FRONTMATTER_DELIMITER, "", doc.body].join("\n");
}

/** Reads a value out of a file's frontmatter without needing the caller to parse the whole file. */
export function readFrontmatterValue(content: string, key: string): string | boolean | undefined {
  return parseFrontmatter(content).frontmatter[key];
}

/** Sets/overwrites a single frontmatter key, preserving the rest of the document. */
export function setFrontmatterValue(content: string, key: string, value: string | boolean): string {
  const doc = parseFrontmatter(content);
  doc.frontmatter[key] = value;
  return stringifyDocument(doc);
}
