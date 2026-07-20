import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, stringifyDocument, setFrontmatterValue } from "../src/lib/frontmatter.js";

test("returns empty frontmatter and the whole content as body when there's no frontmatter block", () => {
  const { frontmatter, body } = parseFrontmatter("# Just a heading\n\nsome text");
  assert.deepEqual(frontmatter, {});
  assert.equal(body, "# Just a heading\n\nsome text");
});

test("parses a frontmatter block and strips it from the body", () => {
  const content = ["---", "jiraId: PROJ-123", "done: true", "---", "", "# Swap Pricing", "", "body text"].join("\n");
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.jiraId, "PROJ-123");
  assert.equal(frontmatter.done, true);
  assert.equal(body, "# Swap Pricing\n\nbody text");
});

test("stringify -> parse round-trips a document with mixed string/boolean frontmatter", () => {
  const original = { frontmatter: { jiraId: "PROJ-123", done: true }, body: "# Title\n\nbody" };
  const rendered = stringifyDocument(original);
  const reparsed = parseFrontmatter(rendered);
  assert.deepEqual(reparsed.frontmatter, original.frontmatter);
  assert.equal(reparsed.body, original.body);
});

test("setFrontmatterValue adds a key to a document with no prior frontmatter", () => {
  const updated = setFrontmatterValue("# Title\n\nbody", "jiraId", "PROJ-1");
  const { frontmatter, body } = parseFrontmatter(updated);
  assert.equal(frontmatter.jiraId, "PROJ-1");
  assert.equal(body, "# Title\n\nbody");
});

test("setFrontmatterValue overwrites an existing key without touching others", () => {
  const original = ["---", "jiraId: PROJ-1", "type: feature", "---", "", "body"].join("\n");
  const updated = setFrontmatterValue(original, "jiraId", "PROJ-2");
  const { frontmatter } = parseFrontmatter(updated);
  assert.equal(frontmatter.jiraId, "PROJ-2");
  assert.equal(frontmatter.type, "feature");
});
