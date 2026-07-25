# Jira Server/Data Center Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kido's Jira integration (`kido init`'s setup prompt, `kido jira sync`, `kido jira pull`) works against Jira Server/Data Center instances (Personal Access Token auth, `/rest/api/2`, wiki markup) in addition to the Cloud support it already has, selected by a `deploymentType` field on stored credentials.

**Architecture:** Port the Cloud/Server split already built and verified in a separate general-purpose Jira agent skill (`C:\Solutions\Skills\skills\jira`) into Kido's own `src/jira/*`, typed and adapted to Kido's existing credential-resolution conventions — the same pattern Kido already used once for `src/jira/adf.ts`. `JiraClient`'s public method signatures stay unchanged, so `src/commands/jira-sync.ts` and `src/commands/jira-pull.ts` need zero changes — only credential shape, auth, request paths, and body encoding change, all internal to `src/jira/*`.

**Tech Stack:** TypeScript, Node.js built-ins only (`node:fetch`, `node:test`) — zero runtime dependencies, unchanged.

## Global Constraints

- New env vars `KIDO_JIRA_DEPLOYMENT_TYPE`, `KIDO_JIRA_ALLOW_INSECURE_TLS` added to `JIRA_ENV_VAR_NAMES`; new `.kido-credentials` file keys `deploymentType`, `allowInsecureTls`.
- `deploymentType` is `"cloud"` (default, including when unset — backward compatible with every existing setup) or `"server"`.
- Cloud credential completeness (unchanged): `baseUrl && email && apiToken && projectKey`. Server credential completeness: `baseUrl && apiToken && projectKey` — no `email`.
- API base path: `/rest/api/3` (cloud), `/rest/api/2` (server).
- Auth header: `Bearer <apiToken>` (server), `Basic base64(email:apiToken)` (cloud, unchanged).
- Description/comment body encoding: ADF via `markdownToAdf`/`adfToMarkdown` (cloud, unchanged); Jira wiki markup via `markdownToWiki`/`wikiToMarkdown` (server, new).
- TLS: a `withTlsEnv` helper sets `NODE_TLS_REJECT_UNAUTHORIZED=0` around a fetch call only when `creds.allowInsecureTls` is true, restoring the prior value immediately after — wraps every fetch in `JiraClient`.
- `searchChildIssues` (Epic → child Stories, used by `jira pull`): cloud keeps `GET /rest/api/3/search/jql` with cursor (`nextPageToken`) pagination; server adds `POST /rest/api/2/search` with `startAt`/`maxResults`/`total` pagination.
- `kido init`'s Jira setup: new first question `"Is this a Server/Data Center instance?"` (default no). If yes: skip the email prompt, label the token prompt `"Jira Personal Access Token:"` instead of `"Jira API token:"`. `allowInsecureTls` is never prompted for interactively.
- `JiraClient`'s public method signatures (`createIssue`, `updateIssue`, `getIssue`, `searchChildIssues`, `attachFile`, `deleteAttachment`, `downloadAttachmentContent`, `transitionToStatus`) do not change — `src/commands/jira-sync.ts` and `src/commands/jira-pull.ts` require no edits in this plan.
- No new shared fake-Jira-server test module beyond one new file, `test/jira-client-server-mode.test.ts` — the existing Cloud-oriented fakes in `test/jira-sync.test.ts`/`test/jira-pull.test.ts` are unchanged.

---

### Task 1: Extract shared markdown block/inline parser into `markdown-blocks.ts`

**Files:**
- Create: `src/jira/markdown-blocks.ts`
- Modify: `src/jira/adf.ts` (full rewrite — see step 2)
- No test file changes — existing `test/adf.test.ts` is the safety net for this refactor.

**Interfaces:**
- Produces: `src/jira/markdown-blocks.ts` exports `parseInline(text: string): MdTextNode[]`, `parseBlock(block: string): MdBlockNode[]`, `splitIntoBlocks(markdown: string): string[]`, and types `MdMark`, `MdTextNode`, `MdHeadingNode`, `MdParagraphNode`, `MdCodeBlockNode`, `MdListItemNode`, `MdBulletListNode`, `MdOrderedListNode`, `MdBlockNode`.
- `src/jira/adf.ts`'s public exports (`markdownToAdf(markdown: string): AdfDocument`, `adfToMarkdown(doc: unknown): string`, and the `Adf*` type names) are unchanged — Task 4 imports these two functions exactly as they exist today.

This is a pure refactor (no behavior change) — the block-splitting and inline-parsing logic currently lives inline in `adf.ts`; Task 2's `wiki.ts` needs the identical logic, so it moves to a shared module first. `test/adf.test.ts`'s existing `deepEqual` assertions on exact node shapes are what proves nothing changed.

- [ ] **Step 1: Run the existing test suite as a baseline**

Run: `npm test`
Expected: all tests pass (67+ tests), including `test/adf.test.ts`. Note the pass count — you'll compare against it after the refactor.

- [ ] **Step 2: Create `src/jira/markdown-blocks.ts`**

```ts
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
```

- [ ] **Step 3: Rewrite `src/jira/adf.ts` to use the shared module**

Replace the entire file content with:

```ts
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
```

- [ ] **Step 4: Run the full test suite again and confirm the same pass count**

Run: `npm test`
Expected: PASS, same test count as Step 1 — `test/adf.test.ts`'s exact-shape assertions confirm the refactor changed nothing observable.

- [ ] **Step 5: Commit**

```bash
git add src/jira/markdown-blocks.ts src/jira/adf.ts
git commit -m "Extract shared markdown block parser from adf.ts into markdown-blocks.ts"
```

---

### Task 2: Add `wiki.ts` (markdown ↔ Jira wiki markup)

**Files:**
- Create: `src/jira/wiki.ts`
- Create: `test/wiki.test.ts`

**Interfaces:**
- Consumes: `parseBlock`, `splitIntoBlocks`, and the `Md*` types from `src/jira/markdown-blocks.ts` (Task 1).
- Produces: `markdownToWiki(markdown: string): string`, `wikiToMarkdown(wiki: string | undefined): string` — Task 4's `client.ts` imports both.

- [ ] **Step 1: Write the failing tests**

Create `test/wiki.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToWiki, wikiToMarkdown } from "../src/jira/wiki.js";

test("converts a plain paragraph", () => {
  const wiki = markdownToWiki("Hello world");
  assert.equal(wiki, "Hello world");
  assert.equal(wikiToMarkdown(wiki), "Hello world");
});

test("round-trips a heading", () => {
  const wiki = markdownToWiki("## Section Title");
  assert.equal(wiki, "h2. Section Title");
  assert.equal(wikiToMarkdown(wiki), "## Section Title");
});

test("round-trips a bullet list", () => {
  const wiki = markdownToWiki("- first\n- second");
  assert.equal(wiki, "* first\n* second");
  assert.equal(wikiToMarkdown(wiki), "- first\n- second");
});

test("round-trips a numbered list", () => {
  const wiki = markdownToWiki("1. first\n2. second");
  assert.equal(wiki, "# first\n# second");
  assert.equal(wikiToMarkdown(wiki), "1. first\n2. second");
});

test("round-trips bold, italic, code, and a link", () => {
  const markdown = "This has **bold**, *italic*, `code`, and a [link](https://example.com).";
  const wiki = markdownToWiki(markdown);
  assert.equal(wiki, "This has *bold*, _italic_, {{code}}, and a [link|https://example.com].");
  assert.equal(wikiToMarkdown(wiki), markdown);
});

test("round-trips a fenced code block", () => {
  const markdown = "```js\nconst x = 1;\n```";
  const wiki = markdownToWiki(markdown);
  assert.equal(wiki, "{code:js}\nconst x = 1;\n{code}");
  assert.equal(wikiToMarkdown(wiki), markdown);
});

test("round-trips a fenced code block containing a blank line", () => {
  const markdown = "```js\nfunction foo() {\n\n  return 1;\n}\n```";
  const wiki = markdownToWiki(markdown);
  assert.equal(wikiToMarkdown(wiki), markdown);
});

test("round-trips a fenced code block with a hyphenated language tag", () => {
  const markdown = '```objective-c\nNSLog(@"hi");\n```';
  const wiki = markdownToWiki(markdown);
  assert.equal(wiki, '{code:objective-c}\nNSLog(@"hi");\n{code}');
  assert.equal(wikiToMarkdown(wiki), markdown);
});

test("wikiToMarkdown returns an empty string for empty input", () => {
  assert.equal(wikiToMarkdown(""), "");
  assert.equal(wikiToMarkdown(undefined), "");
});

test("does not corrupt literal underscores in filenames or identifiers", () => {
  const markdown = "See the my_file_name.txt config and check snake_case_value";
  const wiki = markdownToWiki(markdown);
  assert.equal(wiki, markdown);
  assert.equal(wikiToMarkdown(wiki), markdown);
});

test("does not corrupt double-underscore identifiers like __init__", () => {
  const markdown = "Run __init__ then check the result";
  const wiki = markdownToWiki(markdown);
  assert.equal(wiki, markdown);
  assert.equal(wikiToMarkdown(wiki), markdown);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/wiki.test.js`
Expected: FAIL — `src/jira/wiki.ts` doesn't exist yet (module-not-found error).

- [ ] **Step 3: Write `src/jira/wiki.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/wiki.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all tests including the new `wiki.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/jira/wiki.ts test/wiki.test.ts
git commit -m "Add markdown<->Jira wiki markup converter for Server/Data Center descriptions"
```

---

### Task 3: Add Server/Data Center credential support

**Files:**
- Modify: `src/jira/credentials.ts` (full rewrite — see step 3)
- Create: `test/jira-credentials.test.ts`

**Interfaces:**
- Produces: `JiraDeploymentType = "cloud" | "server"`; `JiraCredentials` interface with `baseUrl: string`, `email?: string`, `apiToken: string`, `projectKey: string`, `deploymentType: JiraDeploymentType`, `allowInsecureTls?: boolean`; `JIRA_ENV_VAR_NAMES` (6 entries now); `JIRA_CREDENTIALS_FILENAME` (unchanged: `.kido-credentials`); `hasResolvableJiraCredentials(repoRoot: string): boolean`; `resolveJiraCredentials(repoRoot: string): JiraCredentials`; `writeJiraCredentialsFile(repoRoot: string, creds: JiraCredentials): void`. Task 4 and Task 5 both consume this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `test/jira-credentials.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasResolvableJiraCredentials,
  resolveJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_CREDENTIALS_FILENAME,
} from "../src/jira/credentials.js";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-jira-creds-"));
}

function clearJiraEnv(): void {
  delete process.env.KIDO_JIRA_BASE_URL;
  delete process.env.KIDO_JIRA_EMAIL;
  delete process.env.KIDO_JIRA_API_TOKEN;
  delete process.env.KIDO_JIRA_PROJECT_KEY;
  delete process.env.KIDO_JIRA_DEPLOYMENT_TYPE;
  delete process.env.KIDO_JIRA_ALLOW_INSECURE_TLS;
}

test("cloud credentials require email; deploymentType defaults to cloud when unset in the file", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({ baseUrl: "https://x.atlassian.net", email: "a@b.com", apiToken: "tok", projectKey: "PROJ" })
    );

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.deploymentType, "cloud");
    assert.equal(creds.email, "a@b.com");
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("server credentials don't require email", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({
        baseUrl: "https://jira.company.com",
        apiToken: "pat-token",
        projectKey: "PROJ",
        deploymentType: "server",
      })
    );

    assert.equal(hasResolvableJiraCredentials(repo), true);
    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.deploymentType, "server");
    assert.equal(creds.email, undefined);
    assert.equal(creds.apiToken, "pat-token");
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("server credentials missing apiToken are NOT resolvable, even with baseUrl and projectKey set", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({ baseUrl: "https://jira.company.com", deploymentType: "server", projectKey: "PROJ" })
    );

    assert.equal(hasResolvableJiraCredentials(repo), false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("allowInsecureTls normalizes the string \"true\" from env vars to a real boolean", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    process.env.KIDO_JIRA_BASE_URL = "https://jira.company.com";
    process.env.KIDO_JIRA_API_TOKEN = "pat-token";
    process.env.KIDO_JIRA_PROJECT_KEY = "PROJ";
    process.env.KIDO_JIRA_DEPLOYMENT_TYPE = "server";
    process.env.KIDO_JIRA_ALLOW_INSECURE_TLS = "true";

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.allowInsecureTls, true);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("allowInsecureTls defaults to false when unset", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({
        baseUrl: "https://jira.company.com",
        apiToken: "pat-token",
        projectKey: "PROJ",
        deploymentType: "server",
      })
    );

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.allowInsecureTls, false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("writeJiraCredentialsFile writes deploymentType and omits email for server credentials", () => {
  const repo = makeRepo();
  try {
    writeJiraCredentialsFile(repo, {
      baseUrl: "https://jira.company.com",
      apiToken: "pat-token",
      projectKey: "PROJ",
      deploymentType: "server",
    });

    const written = JSON.parse(readFileSync(join(repo, JIRA_CREDENTIALS_FILENAME), "utf8"));
    assert.equal(written.deploymentType, "server");
    assert.equal(written.email, undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/jira-credentials.test.js`
Expected: FAIL — `deploymentType`/`allowInsecureTls` don't exist on the current `JiraCredentials` shape, and server-mode credentials (no `email`) aren't recognized as complete yet.

- [ ] **Step 3: Rewrite `src/jira/credentials.ts`**

Replace the entire file content with:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type JiraDeploymentType = "cloud" | "server";

export interface JiraCredentials {
  baseUrl: string;
  /** Server/Data Center doesn't use this — Personal Access Token auth needs no email. */
  email?: string;
  apiToken: string;
  projectKey: string;
  deploymentType: JiraDeploymentType;
  /** Disables TLS certificate verification for this client's requests — insecure, last resort.
   * Prefer NODE_EXTRA_CA_CERTS for a self-signed/internal-CA Server/DC instance instead. */
  allowInsecureTls?: boolean;
}

export const JIRA_ENV_VAR_NAMES = [
  "KIDO_JIRA_BASE_URL",
  "KIDO_JIRA_EMAIL",
  "KIDO_JIRA_API_TOKEN",
  "KIDO_JIRA_PROJECT_KEY",
  "KIDO_JIRA_DEPLOYMENT_TYPE",
  "KIDO_JIRA_ALLOW_INSECURE_TLS",
] as const;

export const JIRA_CREDENTIALS_FILENAME = ".kido-credentials";

interface RawJiraCredentials {
  baseUrl?: string | undefined;
  email?: string | undefined;
  apiToken?: string | undefined;
  projectKey?: string | undefined;
  deploymentType?: string | undefined;
  allowInsecureTls?: string | boolean | undefined;
}

function fromEnv(): RawJiraCredentials {
  return {
    baseUrl: process.env.KIDO_JIRA_BASE_URL,
    email: process.env.KIDO_JIRA_EMAIL,
    apiToken: process.env.KIDO_JIRA_API_TOKEN,
    projectKey: process.env.KIDO_JIRA_PROJECT_KEY,
    deploymentType: process.env.KIDO_JIRA_DEPLOYMENT_TYPE,
    allowInsecureTls: process.env.KIDO_JIRA_ALLOW_INSECURE_TLS,
  };
}

function fromFile(repoRoot: string): RawJiraCredentials {
  const fallbackPath = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  if (!existsSync(fallbackPath)) return {};
  try {
    return JSON.parse(readFileSync(fallbackPath, "utf8"));
  } catch {
    return {};
  }
}

function isComplete(creds: RawJiraCredentials): boolean {
  if (creds.deploymentType === "server") {
    return Boolean(creds.baseUrl && creds.apiToken && creds.projectKey);
  }
  return Boolean(creds.baseUrl && creds.email && creds.apiToken && creds.projectKey);
}

function normalize(creds: RawJiraCredentials): JiraCredentials {
  return {
    baseUrl: creds.baseUrl!,
    email: creds.email,
    apiToken: creds.apiToken!,
    projectKey: creds.projectKey!,
    deploymentType: creds.deploymentType === "server" ? "server" : "cloud",
    allowInsecureTls: creds.allowInsecureTls === true || creds.allowInsecureTls === "true",
  };
}

/** Non-throwing check — used by `kido init` to decide whether to offer setup at all. */
export function hasResolvableJiraCredentials(repoRoot: string): boolean {
  return isComplete(fromEnv()) || isComplete(fromFile(repoRoot));
}

/**
 * Resolves Jira credentials: user-scoped env vars first (decision #16),
 * falling back to a gitignored local file at the repo root. Never touches
 * machine-wide env vars or requires elevated privileges. `deploymentType`
 * is "cloud" (default, including when unset) or "server" — server mode
 * doesn't require `email` (Personal Access Token auth instead of Basic).
 */
export function resolveJiraCredentials(repoRoot: string): JiraCredentials {
  const envCreds = fromEnv();
  if (isComplete(envCreds)) return normalize(envCreds);

  const fileCreds = fromFile(repoRoot);
  if (isComplete(fileCreds)) return normalize(fileCreds);

  throw new Error(
    `Jira credentials not found. Set ${JIRA_ENV_VAR_NAMES.join(", ")} ` +
      `as user-scoped environment variables, or create ${JIRA_CREDENTIALS_FILENAME} (gitignored) with ` +
      `{ "baseUrl", "email"?, "apiToken", "projectKey", "deploymentType"?, "allowInsecureTls"? } — ` +
      `"email" is only required when "deploymentType" is "cloud" (the default).`
  );
}

/** Writes the credentials file directly — used by `kido init`'s optional first-time setup prompt. */
export function writeJiraCredentialsFile(repoRoot: string, creds: JiraCredentials): void {
  const path = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", "utf8");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/jira-credentials.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Pay attention to `test/jira-sync.test.ts`, `test/jira-pull.test.ts`, and `test/init-jira-setup.test.ts` specifically — they all construct Cloud-shaped credentials (via `setJiraEnv()`/hand-written JSON with `email` but no `deploymentType`) and must still pass unchanged, since `deploymentType` defaults to `"cloud"`.

- [ ] **Step 6: Commit**

```bash
git add src/jira/credentials.ts test/jira-credentials.test.ts
git commit -m "Add deploymentType/allowInsecureTls to Jira credentials for Server/Data Center support"
```

---

### Task 4: Server/Data Center support in `JiraClient`

**Files:**
- Modify: `src/jira/client.ts` (full rewrite — see step 3)
- Create: `test/jira-client-server-mode.test.ts`

**Interfaces:**
- Consumes: `markdownToAdf`/`adfToMarkdown` from `src/jira/adf.ts` (Task 1, unchanged), `markdownToWiki`/`wikiToMarkdown` from `src/jira/wiki.ts` (Task 2), `JiraCredentials`/`JiraDeploymentType` from `src/jira/credentials.ts` (Task 3).
- Produces: `JiraClient` — same public method signatures as before construction `new JiraClient(creds: JiraCredentials)`, methods `createIssue`, `updateIssue`, `getIssue`, `searchChildIssues`, `attachFile`, `deleteAttachment`, `downloadAttachmentContent`, `transitionToStatus` all unchanged in signature. `src/commands/jira-sync.ts` and `src/commands/jira-pull.ts` need no edits.

- [ ] **Step 1: Write the failing tests**

Create `test/jira-client-server-mode.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { JiraClient } from "../src/jira/client.js";
import type { JiraCredentials } from "../src/jira/credentials.js";

interface CapturedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

interface FakeServerState {
  requests: CapturedRequest[];
  issues: Map<string, { fields: Record<string, unknown> }>;
}

/** A small, purpose-built fake Jira Server/Data Center REST API (/rest/api/2) — enough of
 * POST/GET /issue(/:key) and POST /search to exercise JiraClient's server-mode branches
 * directly, without retrofitting the larger Cloud-oriented fakes in jira-sync.test.ts /
 * jira-pull.test.ts (see docs/superpowers/specs/2026-07-25-jira-server-data-center-support-design.md). */
function startFakeServerJira(): Promise<{ server: Server; url: string; state: FakeServerState }> {
  const state: FakeServerState = { requests: [], issues: new Map() };
  let nextId = 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "", "http://localhost");
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      state.requests.push({
        method: req.method ?? "",
        path: url.pathname,
        authorization: req.headers.authorization,
        body: parsedBody,
      });

      if (req.method === "POST" && url.pathname === "/rest/api/2/issue") {
        const key = `SRV-${nextId++}`;
        state.issues.set(key, { fields: (parsedBody as { fields: Record<string, unknown> }).fields });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const issueMatch = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && issueMatch) {
        const key = issueMatch[1]!;
        const issue = state.issues.get(key);
        if (!issue) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key, fields: issue.fields }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/rest/api/2/search") {
        const { startAt = 0 } = (parsedBody ?? {}) as { startAt?: number };
        const pageSize = 2; // force multi-page pagination regardless of requested maxResults
        const allIssues = [1, 2, 3, 4, 5].map((n) => ({
          key: `SRV-CHILD-${n}`,
          fields: { summary: `Child ${n}`, issuetype: { name: "Story" }, parent: { key: "SRV-EPIC" } },
        }));
        const page = allIssues.slice(startAt, startAt + pageSize);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issues: page, startAt, maxResults: pageSize, total: allIssues.length }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, state });
    });
  });
}

function serverCreds(baseUrl: string): JiraCredentials {
  return {
    baseUrl,
    apiToken: "fake-pat",
    projectKey: "SRV",
    deploymentType: "server",
  };
}

test("createIssue on Server/DC uses Bearer auth, /rest/api/2, and a wiki-markup (string) description body", async () => {
  const { server, url, state } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    const result = await client.createIssue({
      summary: "Test issue",
      description: "**bold** text",
      issueType: "Story",
    });

    assert.equal(result.key, "SRV-1");
    const createRequest = state.requests.find((r) => r.method === "POST" && r.path === "/rest/api/2/issue")!;
    assert.equal(createRequest.authorization, "Bearer fake-pat");
    const body = createRequest.body as { fields: { description: unknown } };
    assert.equal(
      typeof body.fields.description,
      "string",
      "Server/DC description must be a wiki-markup string, not an ADF doc object"
    );
    assert.equal(body.fields.description, "*bold* text");
  } finally {
    server.close();
  }
});

test("getIssue on Server/DC parses the description back from wiki markup to markdown", async () => {
  const { server, url } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    await client.createIssue({ summary: "Test issue", description: "line one", issueType: "Story" });

    const issue = await client.getIssue("SRV-1");
    assert.equal(issue.description, "line one");
  } finally {
    server.close();
  }
});

test("searchChildIssues on Server/DC paginates via POST /rest/api/2/search using startAt/maxResults", async () => {
  const { server, url, state } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    const children = await client.searchChildIssues("SRV-EPIC");
    assert.deepEqual(
      children.map((c) => c.key),
      ["SRV-CHILD-1", "SRV-CHILD-2", "SRV-CHILD-3", "SRV-CHILD-4", "SRV-CHILD-5"]
    );
    const searchCalls = state.requests.filter((r) => r.method === "POST" && r.path === "/rest/api/2/search");
    assert.equal(searchCalls.length, 3, "expected 3 pages (2 + 2 + 1) via startAt/maxResults pagination");
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/jira-client-server-mode.test.js`
Expected: FAIL — `JiraClient` doesn't yet accept `deploymentType: "server"` credentials correctly (still hardcodes `/rest/api/3` and Basic auth), so all three tests fail (404s from hitting the wrong path, or a thrown error from `email` being undefined in the Basic-auth base64 encoding).

- [ ] **Step 3: Rewrite `src/jira/client.ts`**

Replace the entire file content with:

```ts
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { JiraCredentials } from "./credentials.js";
import { markdownToAdf, adfToMarkdown } from "./adf.js";
import { markdownToWiki, wikiToMarkdown } from "./wiki.js";

export type JiraIssueType = "Epic" | "Story" | "Bug";

export interface JiraIssueInput {
  summary: string;
  description: string;
  issueType: JiraIssueType;
  /** Epic key to nest a Story under (Jira's "parent" field for team-managed projects). */
  parentKey?: string;
}

export interface JiraIssueResult {
  key: string;
  url: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  /** Jira's `content` field — an absolute URL to GET the raw attachment bytes. */
  contentUrl: string;
}

export interface JiraIssueDetails {
  key: string;
  summary: string;
  description: string;
  issueType: JiraIssueType;
  parentKey?: string | undefined;
  /** Only populated by getIssue — searchChildIssues' results never carry this. */
  attachments?: JiraAttachment[] | undefined;
}

const API_BASE: Record<JiraCredentials["deploymentType"], string> = {
  cloud: "/rest/api/3",
  server: "/rest/api/2",
};

// NODE_TLS_REJECT_UNAUTHORIZED is read on every TLS connect, so toggling it around a single
// fetch() and restoring it afterward keeps the effect scoped to that call. Safe because Kido
// issues Jira requests sequentially within one CLI invocation, never concurrently. Ported from
// the standalone jira skill's scripts/client.mjs.
async function withTlsEnv<T>(creds: JiraCredentials, fn: () => Promise<T>): Promise<T> {
  if (!creds.allowInsecureTls) return fn();
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

/** Thin fetch-based Jira REST client — no SDK dependency (decision #13). Supports both Jira
 * Cloud (Basic auth, /rest/api/3, Atlassian Document Format) and Server/Data Center (Bearer
 * Personal Access Token, /rest/api/2, wiki markup), selected by `creds.deploymentType`. */
export class JiraClient {
  private readonly isServer: boolean;
  private readonly apiBase: string;

  constructor(private readonly creds: JiraCredentials) {
    this.isServer = creds.deploymentType === "server";
    this.apiBase = API_BASE[creds.deploymentType];
  }

  private authHeader(): string {
    if (this.isServer) return `Bearer ${this.creds.apiToken}`;
    const token = Buffer.from(`${this.creds.email}:${this.creds.apiToken}`).toString("base64");
    return `Basic ${token}`;
  }

  private formatBody(markdown: string): unknown {
    return this.isServer ? markdownToWiki(markdown) : markdownToAdf(markdown);
  }

  private parseBody(raw: unknown): string {
    if (!raw) return "";
    return this.isServer ? wikiToMarkdown(raw as string) : adfToMarkdown(raw);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await withTlsEnv(this.creds, () =>
      fetch(`${this.creds.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
          ...init.headers,
        },
      })
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }
    return response;
  }

  /** Creates a new issue. Idempotency (create-or-update by stored key) is the caller's job — see jira-sync.ts. */
  async createIssue(input: JiraIssueInput): Promise<JiraIssueResult> {
    const fields: Record<string, unknown> = {
      project: { key: this.creds.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType },
      description: this.formatBody(input.description),
    };
    if (input.parentKey) {
      fields.parent = { key: input.parentKey };
    }

    const response = await this.request(`${this.apiBase}/issue`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    const data = (await response.json()) as { key: string };
    return { key: data.key, url: `${this.creds.baseUrl}/browse/${data.key}` };
  }

  async updateIssue(key: string, input: Pick<JiraIssueInput, "summary" | "description">): Promise<void> {
    await this.request(`${this.apiBase}/issue/${key}`, {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          summary: input.summary,
          description: this.formatBody(input.description),
        },
      }),
    });
  }

  /** Reads a single issue back — the reverse of createIssue/updateIssue, used by `kido jira pull`. */
  async getIssue(key: string): Promise<JiraIssueDetails> {
    const response = await this.request(
      `${this.apiBase}/issue/${key}?fields=summary,description,issuetype,parent,attachment`,
      { method: "GET" }
    );
    const data = (await response.json()) as {
      key: string;
      fields: {
        summary: string;
        description?: unknown;
        issuetype: { name: string };
        parent?: { key: string };
        attachment?: Array<{ id: string; filename: string; content: string }>;
      };
    };
    return {
      key: data.key,
      summary: data.fields.summary,
      description: this.parseBody(data.fields.description),
      issueType: data.fields.issuetype.name as JiraIssueType,
      parentKey: data.fields.parent?.key,
      attachments: data.fields.attachment?.map((a) => ({ id: a.id, filename: a.filename, contentUrl: a.content })),
    };
  }

  /** Lists Stories nested under an Epic, oldest first — used to reconstruct tasks.md on pull.
   * Cloud: GET /search/jql (the GET /search endpoint it replaces was removed by Atlassian, 410
   * Gone), cursor-paginated via nextPageToken. Server/DC: POST /search (the classic API, still
   * present on v2 — /search/jql doesn't exist pre-Cloud), paginated via startAt/maxResults/total. */
  async searchChildIssues(epicKey: string): Promise<JiraIssueDetails[]> {
    return this.isServer ? this.searchChildIssuesServer(epicKey) : this.searchChildIssuesCloud(epicKey);
  }

  private async searchChildIssuesCloud(epicKey: string): Promise<JiraIssueDetails[]> {
    const jql = encodeURIComponent(`parent = ${epicKey} ORDER BY created ASC`);
    const issues: Array<{
      key: string;
      fields: { summary: string; description?: unknown; issuetype: { name: string }; parent?: { key: string } };
    }> = [];
    let nextPageToken: string | undefined;
    do {
      const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const response = await this.request(
        `${this.apiBase}/search/jql?jql=${jql}&fields=summary,description,issuetype,parent${tokenParam}`,
        { method: "GET" }
      );
      const data = (await response.json()) as {
        issues: typeof issues;
        nextPageToken?: string;
        isLast?: boolean;
      };
      issues.push(...data.issues);
      nextPageToken = data.isLast === false ? data.nextPageToken : undefined;
    } while (nextPageToken);

    return issues.map((issue) => this.toIssueDetails(issue));
  }

  private async searchChildIssuesServer(epicKey: string): Promise<JiraIssueDetails[]> {
    const jql = `parent = ${epicKey} ORDER BY created ASC`;
    const issues: Array<{
      key: string;
      fields: { summary: string; description?: unknown; issuetype: { name: string }; parent?: { key: string } };
    }> = [];
    const maxResults = 50;
    let startAt = 0;
    let total = Infinity;
    while (startAt < total) {
      const response = await this.request(`${this.apiBase}/search`, {
        method: "POST",
        body: JSON.stringify({ jql, fields: ["summary", "description", "issuetype", "parent"], startAt, maxResults }),
      });
      const data = (await response.json()) as {
        issues: typeof issues;
        startAt: number;
        maxResults: number;
        total: number;
      };
      issues.push(...data.issues);
      total = data.total;
      if (data.issues.length === 0) break; // safety net against a miscounted total looping forever
      startAt += data.issues.length;
    }

    return issues.map((issue) => this.toIssueDetails(issue));
  }

  private toIssueDetails(issue: {
    key: string;
    fields: { summary: string; description?: unknown; issuetype: { name: string }; parent?: { key: string } };
  }): JiraIssueDetails {
    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: this.parseBody(issue.fields.description),
      issueType: issue.fields.issuetype.name as JiraIssueType,
      parentKey: issue.fields.parent?.key,
    };
  }

  /** Uploads a real file as a new attachment. Bypasses this.request() — multipart needs fetch to
   * set its own Content-Type boundary, not the shared JSON one. Reads the file fresh off disk
   * each call, so callers must write any frontmatter mutation (e.g. jiraId) to `filePath`
   * *before* calling this, not after. */
  async attachFile(key: string, filePath: string): Promise<JiraAttachment> {
    const buffer = readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), basename(filePath));
    const response = await withTlsEnv(this.creds, () =>
      fetch(`${this.creds.baseUrl}${this.apiBase}/issue/${key}/attachments`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "X-Atlassian-Token": "no-check",
          Accept: "application/json",
        },
        body: form,
      })
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }
    const [attachment] = (await response.json()) as Array<{ id: string; filename: string; content: string }>;
    return { id: attachment!.id, filename: attachment!.filename, contentUrl: attachment!.content };
  }

  /** Jira attachments can't be updated in place — callers delete an existing one by ID before a
   * fresh upload, so re-syncing doesn't pile up duplicate copies of the same file. */
  async deleteAttachment(attachmentId: string): Promise<void> {
    await this.request(`${this.apiBase}/attachment/${attachmentId}`, { method: "DELETE" });
  }

  /** Downloads an attachment's raw bytes. A different shape from this.request()'s JSON handling,
   * and contentUrl is already an absolute URL (from getIssue's attachment metadata), not a path. */
  async downloadAttachmentContent(contentUrl: string): Promise<Buffer> {
    const response = await withTlsEnv(this.creds, () =>
      fetch(contentUrl, { headers: { Authorization: this.authHeader() } })
    );
    if (!response.ok) {
      throw new Error(`Jira API error ${response.status}: failed to download attachment`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async transitionToStatus(key: string, statusName: string): Promise<void> {
    const transitionsResponse = await this.request(`${this.apiBase}/issue/${key}/transitions`, { method: "GET" });
    const { transitions } = (await transitionsResponse.json()) as {
      transitions: Array<{ id: string; name: string }>;
    };
    const match = transitions.find((t) => t.name.toLowerCase() === statusName.toLowerCase());
    if (!match) {
      throw new Error(`No transition to "${statusName}" available for ${key} (available: ${transitions.map((t) => t.name).join(", ")})`);
    }
    await this.request(`${this.apiBase}/issue/${key}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/jira-client-server-mode.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all tests — critically including the existing `test/jira-sync.test.ts` and `test/jira-pull.test.ts` Cloud-mode suites, which must pass completely unchanged (they never set `deploymentType`, so they exercise the `"cloud"` default path through every new branch you just added).

- [ ] **Step 6: Commit**

```bash
git add src/jira/client.ts test/jira-client-server-mode.test.ts
git commit -m "Add Server/Data Center support to JiraClient (Bearer auth, /rest/api/2, wiki markup, TLS toggle)"
```

---

### Task 5: `kido init`'s Jira setup prompt for Server/Data Center

**Files:**
- Modify: `src/commands/init.ts:1-16` (imports) and `src/commands/init.ts`'s `handleJiraSetup` function
- Modify: `test/init-jira-setup.test.ts` (append two new tests)

**Interfaces:**
- Consumes: `JiraDeploymentType`, `writeJiraCredentialsFile(repoRoot: string, creds: JiraCredentials): void`, `hasResolvableJiraCredentials`, `JIRA_ENV_VAR_NAMES`, `JIRA_CREDENTIALS_FILENAME` from `src/jira/credentials.ts` (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `test/init-jira-setup.test.ts` (add these two `test(...)` blocks after the existing ones, keeping the existing imports — no new imports needed, everything used here is already imported in that file):

```ts
test("with no Jira credentials configured and no TTY, the guidance message lists the new deployment-type/TLS env vars too", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  const originalLog = console.log;
  const logged: string[] = [];
  try {
    delete process.env.KIDO_JIRA_BASE_URL;
    delete process.env.KIDO_JIRA_EMAIL;
    delete process.env.KIDO_JIRA_API_TOKEN;
    delete process.env.KIDO_JIRA_PROJECT_KEY;
    delete process.env.KIDO_JIRA_DEPLOYMENT_TYPE;
    delete process.env.KIDO_JIRA_ALLOW_INSECURE_TLS;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };

    await runInit(repo, { noLegacy: true });

    const output = logged.join("\n");
    assert.match(output, /KIDO_JIRA_DEPLOYMENT_TYPE/);
    assert.match(output, /KIDO_JIRA_ALLOW_INSECURE_TLS/);
  } finally {
    console.log = originalLog;
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("when Server/DC credentials (no email) are already resolvable via an existing file, init doesn't overwrite it or prompt", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  try {
    delete process.env.KIDO_JIRA_BASE_URL;
    delete process.env.KIDO_JIRA_EMAIL;
    delete process.env.KIDO_JIRA_API_TOKEN;
    delete process.env.KIDO_JIRA_PROJECT_KEY;
    delete process.env.KIDO_JIRA_DEPLOYMENT_TYPE;
    delete process.env.KIDO_JIRA_ALLOW_INSECURE_TLS;

    const existing = {
      baseUrl: "https://jira.company.com",
      apiToken: "pat-token",
      projectKey: "EXIST",
      deploymentType: "server",
    };
    const credsPath = join(repo, JIRA_CREDENTIALS_FILENAME);
    writeFileSync(credsPath, JSON.stringify(existing));

    await runInit(repo, { noLegacy: true });

    const stillThere = JSON.parse(readFileSync(credsPath, "utf8"));
    assert.deepEqual(stillThere, existing);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/init-jira-setup.test.js`
Expected: FAIL on the first new test — the current guidance message only lists the 4 original env vars, not the 2 new ones. (The second new test should already pass at this point, since Task 3 already made `hasResolvableJiraCredentials` recognize server-mode files — that's fine, it's still a needed regression check for this task.)

- [ ] **Step 3: Update `src/commands/init.ts`**

Add `type JiraDeploymentType` to the existing `../jira/credentials.js` import (find this exact import block near the top of the file):

```ts
import {
  hasResolvableJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_ENV_VAR_NAMES,
  JIRA_CREDENTIALS_FILENAME,
} from "../jira/credentials.js";
```

Change it to:

```ts
import {
  hasResolvableJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_ENV_VAR_NAMES,
  JIRA_CREDENTIALS_FILENAME,
  type JiraDeploymentType,
} from "../jira/credentials.js";
```

Then find the `handleJiraSetup` function's final block — currently:

```ts
  const baseUrl = await prompt.askText("Jira base URL (e.g. https://yourteam.atlassian.net):");
  const email = await prompt.askText("Jira account email:");
  const apiToken = await prompt.askText("Jira API token:");
  const projectKey = await prompt.askText("Jira project key (e.g. PROJ):");
  writeJiraCredentialsFile(repoRoot, { baseUrl, email, apiToken, projectKey });
  console.log(`Wrote ${JIRA_CREDENTIALS_FILENAME} — Jira sync is ready to use.`);
}
```

Replace it with:

```ts
  const isServer = await prompt.askYesNo("Is this a Server/Data Center instance?", false);
  const deploymentType: JiraDeploymentType = isServer ? "server" : "cloud";

  const baseUrl = await prompt.askText(
    isServer ? "Jira base URL (e.g. https://jira.yourcompany.com):" : "Jira base URL (e.g. https://yourteam.atlassian.net):"
  );
  const email = isServer ? undefined : await prompt.askText("Jira account email:");
  const apiToken = await prompt.askText(isServer ? "Jira Personal Access Token:" : "Jira API token:");
  const projectKey = await prompt.askText("Jira project key (e.g. PROJ):");
  writeJiraCredentialsFile(repoRoot, { baseUrl, email, apiToken, projectKey, deploymentType });
  console.log(`Wrote ${JIRA_CREDENTIALS_FILENAME} — Jira sync is ready to use.`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/init-jira-setup.test.js`
Expected: PASS (all tests in this file, including the 2 new ones).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts test/init-jira-setup.test.ts
git commit -m "Ask Cloud vs Server/Data Center in kido init's Jira setup prompt"
```

---

### Task 6: Documentation updates

**Files:**
- Modify: `README.md:37`
- Modify: `DESIGN.md:49`

No interfaces, no tests — this task is prose only, sequenced last so it accurately describes the finished feature.

- [ ] **Step 1: Update `README.md`**

Find this line (currently line 37):

```
This scaffolds `kido/docs/` + `kido/changes/`, generates six Claude Code skills/commands under `.claude/`, and offers to seed `kido/docs/` from a legacy repo or set up Jira credentials.
```

Replace it with:

```
This scaffolds `kido/docs/` + `kido/changes/`, generates six Claude Code skills/commands under `.claude/`, and offers to seed `kido/docs/` from a legacy repo or set up Jira credentials (Cloud or Server/Data Center).
```

- [ ] **Step 2: Update `DESIGN.md`**

Find this line (currently line 49):

```
- Jira credentials: user-scoped env vars primary, gitignored `.kido-credentials` file fallback. `kido init` offers to set this up on first run if neither is already configured — writes the file directly, or prints env-var instructions, per the user's choice. Token entry is plaintext.
```

Replace it with:

```
- Jira credentials: user-scoped env vars primary, gitignored `.kido-credentials` file fallback. `kido init` offers to set this up on first run if neither is already configured — writes the file directly, or prints env-var instructions, per the user's choice. Token entry is plaintext. Supports both Jira Cloud (Basic auth, email + API token, `/rest/api/3`, ADF-encoded descriptions) and Server/Data Center (Bearer auth, Personal Access Token, no email, `/rest/api/2`, wiki-markup-encoded descriptions) via `deploymentType`; a self-signed/internal-CA Server/DC instance is handled via the standard `NODE_EXTRA_CA_CERTS` env var (proper fix) or `allowInsecureTls` (last resort, disables TLS verification).
```

- [ ] **Step 3: Verify the full suite still passes (docs-only change, but confirms nothing else was left uncommitted)**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 4: Commit**

```bash
git add README.md DESIGN.md
git commit -m "Document Jira Server/Data Center support in README and DESIGN.md"
```
