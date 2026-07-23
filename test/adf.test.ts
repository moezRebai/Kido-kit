import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToAdf, adfToMarkdown } from "../src/jira/adf.js";

test("markdownToAdf: heading becomes a heading node with the right level", () => {
  const doc = markdownToAdf("## Section title");
  assert.deepEqual(doc.content, [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section title" }] },
  ]);
});

test("markdownToAdf: inline marks (code/bold/italic/link)", () => {
  const doc = markdownToAdf("Some `code`, **bold**, *italic*, and [a link](https://example.com).");
  assert.deepEqual(doc.content, [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Some " },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: ", " },
        { type: "text", text: "bold", marks: [{ type: "strong" }] },
        { type: "text", text: ", " },
        { type: "text", text: "italic", marks: [{ type: "em" }] },
        { type: "text", text: ", and " },
        { type: "text", text: "a link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: "." },
      ],
    },
  ]);
});

test("markdownToAdf: flat bullet and ordered lists", () => {
  const bullets = markdownToAdf("- one\n- two");
  assert.equal(bullets.content[0]!.type, "bulletList");
  const numbered = markdownToAdf("1. one\n2. two");
  assert.equal(numbered.content[0]!.type, "orderedList");
});

test("markdownToAdf: fenced code block preserves language and text", () => {
  const doc = markdownToAdf("```ts\nconst x = 1;\n```");
  assert.deepEqual(doc.content, [
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
  ]);
});

test("markdownToAdf: mermaid fenced block round-trips as a plain codeBlock (Jira never renders it as a diagram)", () => {
  const mermaid = "```mermaid\nflowchart TB\n  a --> b\n```";
  const doc = markdownToAdf(mermaid);
  assert.equal(doc.content[0]!.type, "codeBlock");
  assert.equal((doc.content[0] as { attrs?: { language: string } }).attrs?.language, "mermaid");
  assert.equal(adfToMarkdown(doc), mermaid);
});

test("markdownToAdf -> adfToMarkdown round-trips headings/lists/marks/code semantically", () => {
  const markdown = [
    "## Overview",
    "",
    "Some `code`, **bold**, and *italic* text.",
    "",
    "- one",
    "- two",
    "",
    "```json",
    '{ "a": 1 }',
    "```",
  ].join("\n");
  const roundTripped = adfToMarkdown(markdownToAdf(markdown));
  assert.match(roundTripped, /^## Overview/);
  assert.match(roundTripped, /`code`/);
  assert.match(roundTripped, /\*\*bold\*\*/);
  assert.match(roundTripped, /\*italic\*/);
  assert.match(roundTripped, /- one/);
  assert.match(roundTripped, /- two/);
  assert.match(roundTripped, /```json\n\{ "a": 1 \}\n```/);
});

test("adfToMarkdown: an unmodeled node type degrades to best-effort plain text instead of throwing", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        content: [{ type: "text", text: "cell one" }, { type: "text", text: "cell two" }],
      },
    ],
  };
  assert.doesNotThrow(() => adfToMarkdown(doc));
  assert.match(adfToMarkdown(doc), /cell one/);
  assert.match(adfToMarkdown(doc), /cell two/);
});

test("adfToMarkdown: empty/missing content returns an empty string", () => {
  assert.equal(adfToMarkdown(undefined), "");
  assert.equal(adfToMarkdown({}), "");
});

test("markdownToAdf: a heading glued directly to a following paragraph (no blank line) still splits", () => {
  const doc = markdownToAdf("## Overview\nThis is the body text.");
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0]!.type, "heading");
  assert.equal(doc.content[1]!.type, "paragraph");
  assert.equal(adfToMarkdown(doc), "## Overview\n\nThis is the body text.");
});

test("markdownToAdf: a heading glued directly to a following ordered list (no blank line) still splits", () => {
  const doc = markdownToAdf("## Steps\n1. first\n2. second");
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0]!.type, "heading");
  assert.equal(doc.content[1]!.type, "orderedList");
});

test("markdownToAdf: a heading glued directly to a following fenced code block (no blank line) still splits", () => {
  const doc = markdownToAdf('## Example\n```js\nconst x = 1;\n```');
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0]!.type, "heading");
  assert.equal(doc.content[1]!.type, "codeBlock");
});

test("markdownToAdf: a wrapped list-item continuation line folds into that item instead of breaking the list", () => {
  const markdown =
    "- Then the response includes bid and ask computed from the current mid and\n  that fixed spread, alongside the existing mid and asOf\n- Second item";
  const doc = markdownToAdf(markdown);
  assert.equal(doc.content[0]!.type, "bulletList");
  const bulletList = doc.content[0] as { content: Array<{ content: Array<{ content: Array<{ text: string }> }> }> };
  assert.equal(bulletList.content.length, 2);
  const firstItemText = bulletList.content[0]!.content[0]!.content.map((n) => n.text).join("");
  assert.equal(
    firstItemText,
    "Then the response includes bid and ask computed from the current mid and that fixed spread, alongside the existing mid and asOf"
  );
  const secondItemText = bulletList.content[1]!.content[0]!.content.map((n) => n.text).join("");
  assert.equal(secondItemText, "Second item");
});

test("markdownToAdf: a bold lead-in paragraph glued directly to a following list (no blank line) splits correctly", () => {
  const doc = markdownToAdf("**US-1: Title**\n- Given a thing\n- When something happens\n- Then a result follows");
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0]!.type, "paragraph");
  assert.equal(doc.content[1]!.type, "bulletList");
  assert.equal((doc.content[1] as { content: unknown[] }).content.length, 3);
});

test("markdownToAdf: a fenced code block containing a blank line stays one codeBlock, not split on the blank line", () => {
  const markdown = "```js\nfunction foo() {\n\n  return 1;\n}\n```";
  const doc = markdownToAdf(markdown);
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0]!.type, "codeBlock");
  assert.equal(adfToMarkdown(doc), markdown);
});

test("markdownToAdf: a fenced code block with a hyphenated language tag round-trips", () => {
  const markdown = '```objective-c\nNSLog(@"hi");\n```';
  const doc = markdownToAdf(markdown);
  assert.equal(doc.content[0]!.type, "codeBlock");
  assert.equal((doc.content[0] as { attrs?: { language: string } }).attrs?.language, "objective-c");
  assert.equal(adfToMarkdown(doc), markdown);
});
