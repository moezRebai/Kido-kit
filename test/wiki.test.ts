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
