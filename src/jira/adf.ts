// Ported from the standalone jira skill's scripts/adf.mjs (C:\Solutions\Skills\skills\jira) —
// same dependency-free markdown<->ADF algorithm, typed. Not a runtime dependency on that skill;
// see docs/superpowers/specs for why kido keeps its own copy. Includes that skill's fixes for
// wrapped list-item continuation lines, and headings/lists glued directly to adjacent text with
// no blank line (block-splitting now flushes on those triggers instead of only on blank lines).
//
// Block-splitting and inline parsing (splitIntoBlocks/parseBlock) live in markdown-blocks.ts,
// shared with wiki.ts (Jira Server/Data Center's wiki markup uses the same markdown segmentation,
// just a different node-to-text renderer).

import {
  parseBlock,
  splitIntoBlocks,
  type MdMark,
  type MdTextNode,
  type MdHeadingNode,
  type MdParagraphNode,
  type MdCodeBlockNode,
  type MdListItemNode,
  type MdBulletListNode,
  type MdOrderedListNode,
  type MdBlockNode,
} from "./markdown-blocks.js";

export type AdfMark = MdMark;
export type AdfTextNode = MdTextNode;
export type AdfHeadingNode = MdHeadingNode;
export type AdfParagraphNode = MdParagraphNode;
export type AdfCodeBlockNode = MdCodeBlockNode;
export type AdfListItemNode = MdListItemNode;
export type AdfBulletListNode = MdBulletListNode;
export type AdfOrderedListNode = MdOrderedListNode;
export type AdfBlockNode = MdBlockNode;

export interface AdfDocument {
  type: "doc";
  version: 1;
  content: AdfBlockNode[];
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
