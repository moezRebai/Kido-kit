// Ported from the standalone jira skill's scripts/adf.mjs (C:\Solutions\Skills\skills\jira) —
// same dependency-free markdown<->ADF algorithm, typed. Not a runtime dependency on that skill;
// see docs/superpowers/specs for why kido keeps its own copy.

export type AdfMark =
  | { type: "code" }
  | { type: "strong" }
  | { type: "em" }
  | { type: "link"; attrs: { href: string } };

export interface AdfTextNode {
  type: "text";
  text: string;
  marks?: AdfMark[];
}
export interface AdfHeadingNode {
  type: "heading";
  attrs: { level: number };
  content: AdfTextNode[];
}
export interface AdfParagraphNode {
  type: "paragraph";
  content: AdfTextNode[];
}
export interface AdfCodeBlockNode {
  type: "codeBlock";
  attrs?: { language: string };
  content: AdfTextNode[];
}
export interface AdfListItemNode {
  type: "listItem";
  content: AdfParagraphNode[];
}
export interface AdfBulletListNode {
  type: "bulletList";
  content: AdfListItemNode[];
}
export interface AdfOrderedListNode {
  type: "orderedList";
  content: AdfListItemNode[];
}
export type AdfBlockNode =
  | AdfHeadingNode
  | AdfParagraphNode
  | AdfCodeBlockNode
  | AdfBulletListNode
  | AdfOrderedListNode;

export interface AdfDocument {
  type: "doc";
  version: 1;
  content: AdfBlockNode[];
}

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

function parseInline(text: string): AdfTextNode[] {
  const nodes: AdfTextNode[] = [];
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

/** Only recognizes a heading when the whole block is a single physical line — a heading glued
 * directly to body text with no blank line falls through to a literal paragraph. Never actually
 * hit by kido's own content: extractTitleAndBody/parseTasks always strip the heading line before
 * handing body text here, and jira-sync's "first section" extraction cuts before the first `##`. */
function parseBlock(block: string): AdfBlockNode[] {
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
    const node: AdfCodeBlockNode = { type: "codeBlock", content: [{ type: "text", text: codeLines.join("\n") }] };
    if (lang) node.attrs = { language: lang };
    return [node];
  }

  const isBulletList = lines.every((l) => /^[-*]\s+/.test(l));
  const isOrderedList = !isBulletList && lines.every((l) => /^\d+\.\s+/.test(l));
  if (isBulletList || isOrderedList) {
    const itemRe = isBulletList ? /^[-*]\s+(.*)$/ : /^\d+\.\s+(.*)$/;
    const items: AdfListItemNode[] = lines.map((l) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: parseInline(itemRe.exec(l)![1]!) }],
    }));
    return [{ type: isBulletList ? "bulletList" : "orderedList", content: items }];
  }

  return [{ type: "paragraph", content: parseInline(lines.join(" ")) }];
}

function splitIntoBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      current.push(line);
      if (!inFence) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.map((b) => b.trim()).filter((b) => b.length > 0);
}

export function markdownToAdf(markdown: string): AdfDocument {
  const blocks = splitIntoBlocks(markdown);
  const content = blocks.flatMap(parseBlock);
  return {
    type: "doc",
    version: 1,
    content: content.length ? content : [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
  };
}

function collectText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (Array.isArray(n.content)) return n.content.map(collectText).join(" ");
  return "";
}

function textNodeToMarkdown(node: AdfTextNode): string {
  if (node.type !== "text") return collectText(node);
  let text = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "code") text = `\`${text}\``;
    else if (mark.type === "strong") text = `**${text}**`;
    else if (mark.type === "em") text = `*${text}*`;
    else if (mark.type === "link") text = `[${text}](${mark.attrs?.href ?? ""})`;
  }
  return text;
}

function inlineToMarkdown(content: AdfTextNode[] | undefined): string {
  return (content ?? []).map(textNodeToMarkdown).join("");
}

function itemToMarkdown(listItem: AdfListItemNode): string {
  return (listItem.content ?? []).map(nodeToMarkdown).join(" ");
}

function nodeToMarkdown(node: unknown): string {
  const n = node as { type?: string } | undefined;
  switch (n?.type) {
    case "heading": {
      const heading = node as AdfHeadingNode;
      return "#".repeat(heading.attrs?.level ?? 1) + " " + inlineToMarkdown(heading.content);
    }
    case "paragraph":
      return inlineToMarkdown((node as AdfParagraphNode).content);
    case "codeBlock": {
      const codeBlock = node as AdfCodeBlockNode;
      const lang = codeBlock.attrs?.language ?? "";
      const text = (codeBlock.content ?? []).map((t) => t.text ?? "").join("");
      return "```" + lang + "\n" + text + "\n```";
    }
    case "bulletList":
      return (node as AdfBulletListNode).content.map((item) => "- " + itemToMarkdown(item)).join("\n");
    case "orderedList":
      return (node as AdfOrderedListNode).content.map((item, i) => `${i + 1}. ` + itemToMarkdown(item)).join("\n");
    default:
      return collectText(node);
  }
}

/** Input is `unknown`, not AdfDocument — real Jira content can include node types this converter
 * never modeled (tables, blockquotes, panels, mentions), and nodeToMarkdown's default case
 * degrades those to best-effort plain text via collectText rather than throwing. */
export function adfToMarkdown(doc: unknown): string {
  const d = doc as { content?: unknown[] } | undefined;
  if (!d?.content) return "";
  return d.content.map(nodeToMarkdown).join("\n\n");
}
