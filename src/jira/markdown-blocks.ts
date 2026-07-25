// Shared markdown block/inline parser for Jira's two description/comment formats: adf.ts
// (Cloud's Atlassian Document Format) and wiki.ts (Server/Data Center's wiki markup). Both
// formats render the same intermediate node shape differently — segmenting markdown into
// blocks and parsing inline marks (bold/italic/code/links) is identical either way. Ported
// from the standalone jira skill's scripts/markdown-blocks.mjs (C:\Solutions\Skills\skills\jira).

export type MdMark =
  | { type: "code" }
  | { type: "strong" }
  | { type: "em" }
  | { type: "link"; attrs: { href: string } };

export interface MdTextNode {
  type: "text";
  text: string;
  marks?: MdMark[];
}
export interface MdHeadingNode {
  type: "heading";
  attrs: { level: number };
  content: MdTextNode[];
}
export interface MdParagraphNode {
  type: "paragraph";
  content: MdTextNode[];
}
export interface MdCodeBlockNode {
  type: "codeBlock";
  attrs?: { language: string };
  content: MdTextNode[];
}
export interface MdListItemNode {
  type: "listItem";
  content: MdParagraphNode[];
}
export interface MdBulletListNode {
  type: "bulletList";
  content: MdListItemNode[];
}
export interface MdOrderedListNode {
  type: "orderedList";
  content: MdListItemNode[];
}
export type MdBlockNode =
  | MdHeadingNode
  | MdParagraphNode
  | MdCodeBlockNode
  | MdBulletListNode
  | MdOrderedListNode;

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

export function parseInline(text: string): MdTextNode[] {
  const nodes: MdTextNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      nodes.push({ type: "text", text: match[1], marks: [{ type: "code" }] });
    } else if (match[2] !== undefined) {
      nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "em" }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "text", text: match[4]!, marks: [{ type: "link", attrs: { href: match[5]! } }] });
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }
  if (nodes.length === 0) nodes.push({ type: "text", text: "" });
  return nodes;
}

/** Headings are always their own single-line block (splitIntoBlocks flushes before/after one),
 * so lines.length === 1 is a reliable heading signal here, not a limitation. */
export function parseBlock(block: string): MdBlockNode[] {
  const lines = block.split("\n");

  const headingMatch = lines.length === 1 ? /^(#{1,6})\s+(.*)$/s.exec(block) : null;
  if (headingMatch) {
    return [{ type: "heading", attrs: { level: headingMatch[1]!.length }, content: parseInline(headingMatch[2]!) }];
  }

  // Jira Cloud renders a ```mermaid fenced block as a plain monospace codeBlock, never an
  // actual diagram — that's a Jira-side limitation, not something kido can fix from here.
  if (/^```\S*$/.test(lines[0]!.trim())) {
    const lang = lines[0]!.trim().slice(3).trim();
    const closesWithFence = lines[lines.length - 1]!.trim() === "```";
    const codeLines = lines.slice(1, closesWithFence ? -1 : undefined);
    const node: MdCodeBlockNode = { type: "codeBlock", content: [{ type: "text", text: codeLines.join("\n") }] };
    if (lang) node.attrs = { language: lang };
    return [node];
  }

  const isBulletList = /^[-*]\s+/.test(lines[0]!);
  const isOrderedList = !isBulletList && /^\d+\.\s+/.test(lines[0]!);
  if (isBulletList || isOrderedList) {
    const itemRe = isBulletList ? /^[-*]\s+(.*)$/ : /^\d+\.\s+(.*)$/;
    // Lines that don't start a new item are continuation lines (wrapped text) of the item
    // above them, folded in with a space — deciding list-type from lines[0] alone (rather than
    // requiring every line to match the marker) is what makes this work.
    const itemTexts: string[] = [];
    for (const l of lines) {
      const m = itemRe.exec(l);
      if (m) {
        itemTexts.push(m[1]!);
      } else if (itemTexts.length) {
        itemTexts[itemTexts.length - 1] += " " + l.trim();
      }
    }
    const items: MdListItemNode[] = itemTexts.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: parseInline(text) }],
    }));
    return [{ type: isBulletList ? "bulletList" : "orderedList", content: items }];
  }

  return [{ type: "paragraph", content: parseInline(lines.join(" ")) }];
}

export function splitIntoBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inFence) flush(); // a fence always starts its own block, even glued to prior text
      inFence = !inFence;
      current.push(line);
      if (!inFence) flush();
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      // ATX headings are always their own block, per CommonMark, even without a blank line
      // separating them from surrounding text.
      flush();
      blocks.push(line);
      continue;
    }
    if (/^(?:[-*]\s+|\d+\.\s+)/.test(line) && current.length && !/^(?:[-*]\s+|\d+\.\s+)/.test(current[0]!)) {
      // A list item glued directly under non-list text (no blank line) still starts a new
      // block — otherwise it gets swallowed into that paragraph. A list item glued under an
      // already-open list just continues it, and an indented continuation line of a wrapped
      // item never matches here.
      flush();
    }
    current.push(line);
  }
  flush();
  return blocks.map((b) => b.trim()).filter((b) => b.length > 0);
}
