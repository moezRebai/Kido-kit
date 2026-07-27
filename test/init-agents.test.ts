import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentsFlag } from "../src/commands/init-agents.js";

test("parses a comma-separated list into agent ids", () => {
  assert.deepEqual(parseAgentsFlag("claude,gemini"), ["claude", "gemini"]);
});

test("trims whitespace around each id", () => {
  assert.deepEqual(parseAgentsFlag(" claude , kilo "), ["claude", "kilo"]);
});

test('"all" expands to every registered agent id', () => {
  assert.deepEqual(parseAgentsFlag("all"), ["claude", "gemini", "kilo"]);
});

test('is case-insensitive for "all"', () => {
  assert.deepEqual(parseAgentsFlag("ALL"), ["claude", "gemini", "kilo"]);
});

test('throws with a helpful message on an unknown id', () => {
  assert.throws(() => parseAgentsFlag("claude,made-up"), /Unknown agent "made-up"/);
});

test("throws on an empty value", () => {
  assert.throws(() => parseAgentsFlag(""), /requires at least one id/);
});
