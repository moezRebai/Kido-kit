import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTasks, extractTitleAndBody } from "../src/lib/tasks-parser.js";

const SAMPLE_TASKS = [
  "## Task 1: Add curve-based pricing calculator",
  "",
  "Implement the calculator service and its unit tests.",
  "",
  "**Depends on:** none",
  "**Test:** calculator returns expected PV for a known swap fixture",
  "",
  "## Task 2: Wire calculator into pricing API endpoint",
  "",
  "Expose the calculator via the existing pricing REST endpoint.",
  "",
  "**Depends on:** Task 1",
  "**Test:** POST /price returns curve-based PV for a swap payload",
].join("\n");

test("parses each `## Task N: <title>` section with its body", () => {
  const tasks = parseTasks(SAMPLE_TASKS);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]?.title, "Add curve-based pricing calculator");
  assert.match(tasks[0]?.body ?? "", /Depends on:\*\* none/);
  assert.equal(tasks[1]?.title, "Wire calculator into pricing API endpoint");
  assert.match(tasks[1]?.body ?? "", /Depends on:\*\* Task 1/);
});

test("returns an empty array for tasks.md with no task headings", () => {
  assert.deepEqual(parseTasks("# Just a title\n\nno tasks here"), []);
});

test("extractTitleAndBody uses the first H1 heading when present", () => {
  const { title, body } = extractTitleAndBody("# Swap Pricing\n\nDetails here.");
  assert.equal(title, "Swap Pricing");
  assert.equal(body, "Details here.");
});

test("extractTitleAndBody falls back to the first non-empty line when there's no heading", () => {
  const { title, body } = extractTitleAndBody("\n\nJust a bug description.\nMore detail.");
  assert.equal(title, "Just a bug description.");
  assert.equal(body, "Just a bug description.\nMore detail.");
});
