// Ported from the standalone jira skill's scripts/wiki.mjs (C:\Solutions\Skills\skills\jira) —
// same dependency-free markdown<->wiki-markup algorithm, typed. Jira Server/Data Center's REST
// API v2 doesn't understand Atlassian Document Format (that's Cloud/v3-only) — descriptions and
// comments use this older wiki markup syntax instead. Built on the same block/inline parser as
// adf.ts (markdown-blocks.ts) — only how each node renders differs.

import { parseBlock, splitIntoBlocks, type MdTextNode, type MdBlockNode, type MdListItemNode } from "./markdown-blocks.js";

function collectText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (Array.isArray(n.content)) return n.content.map(collectText).join(" ");
  return "";
}

function textNodeToWiki(node: MdTextNode): string {
  if (node.type !== "text") return collectText(node);
  let text = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "code") text = `{{${text}}}`;
    else if (mark.type === "strong") text = `*${text}*`;
    else if (mark.type === "em") text = `_${text}_`;
    else if (mark.type === "link") text = `[${text}|${mark.attrs?.href ?? ""}]`;
  }
  return text;
}

function inlineToWiki(content: MdTextNode[] | undefined): string {
  return (content ?? []).map(textNodeToWiki).join("");
}

function itemToWiki(listItem: MdListItemNode): string {
  return (listItem.content ?? []).map(nodeToWiki).join(" ");
}

function nodeToWiki(node: unknown): string {
  const n = node as MdBlockNode | undefined;
  switch (n?.type) {
    case "heading":
      return `h${n.attrs?.level ?? 1}. ` + inlineToWiki(n.content);
    case "paragraph":
      return inlineToWiki(n.content);
    case "codeBlock": {
      const lang = n.attrs?.language;
      const text = (n.content ?? []).map((t) => t.text ?? "").join("");
      return (lang ? `{code:${lang}}` : "{code}") + "\n" + text + "\n{code}";
    }
    case "bulletList":
      return (n.content ?? []).map((item) => "* " + itemToWiki(item)).join("\n");
    case "orderedList":
      return (n.content ?? []).map((item) => "# " + itemToWiki(item)).join("\n");
    default:
      return collectText(node);
  }
}

export function markdownToWiki(markdown: string): string {
  const blocks = splitIntoBlocks(markdown);
  const nodes = blocks.flatMap(parseBlock);
  return nodes.map(nodeToWiki).join("\n\n");
}

function splitWikiBlocks(wiki: string): string[] {
  const lines = wiki.replace(/\r\n/g, "\n").split("\n");
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
    if (/^\{code(?::\S+)?\}$/.test(line.trim())) {
      if (!inFence) flush();
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
    if (/^h[1-6]\.\s+/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks.map((b) => b.trim()).filter((b) => b.length > 0);
}

function inlineWikiToMarkdown(text: string): string {
  return text.replace(
    /\{\{([^}]+)\}\}|\*([^*]+)\*|(?<!\w)_([^_]+)_(?!\w)|\[([^\]|]+)\|([^\]]+)\]/g,
    (match, code: string | undefined, bold: string | undefined, italic: string | undefined, linkText: string | undefined, href: string | undefined) => {
      if (code !== undefined) return `\`${code}\``;
      if (bold !== undefined) return `**${bold}**`;
      if (italic !== undefined) return `*${italic}*`;
      if (linkText !== undefined) return `[${linkText}](${href})`;
      return match;
    }
  );
}

function wikiBlockToMarkdown(block: string): string {
  const lines = block.split("\n");

  const headingMatch = lines.length === 1 ? /^h([1-6])\.\s+(.*)$/s.exec(block) : null;
  if (headingMatch) {
    return "#".repeat(Number(headingMatch[1])) + " " + inlineWikiToMarkdown(headingMatch[2]!);
  }

  const codeMatch = /^\{code(?::(\S+))?\}$/.exec(lines[0]!);
  if (codeMatch) {
    const lang = codeMatch[1] ?? "";
    const closesWithFence = lines[lines.length - 1]!.trim() === "{code}";
    const codeLines = lines.slice(1, closesWithFence ? -1 : undefined);
    return "```" + lang + "\n" + codeLines.join("\n") + "\n```";
  }

  const isBulletList = /^\*\s+/.test(lines[0]!);
  const isOrderedList = !isBulletList && /^#\s+/.test(lines[0]!);
  if (isBulletList || isOrderedList) {
    const itemRe = isBulletList ? /^\*\s+(.*)$/ : /^#\s+(.*)$/;
    let n = 0;
    return lines
      .map((l) => {
        const m = itemRe.exec(l);
        if (!m) return null;
        n += 1;
        return (isBulletList ? "- " : `${n}. `) + inlineWikiToMarkdown(m[1]!);
      })
      .filter((l): l is string => l !== null)
      .join("\n");
  }

  return inlineWikiToMarkdown(lines.join(" "));
}

export function wikiToMarkdown(wiki: string | undefined): string {
  if (!wiki) return "";
  return splitWikiBlocks(wiki).map(wikiBlockToMarkdown).join("\n\n");
}
