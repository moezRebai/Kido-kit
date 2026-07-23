import { test } from "node:test";
import assert from "node:assert/strict";
import { printWelcomeBanner } from "../src/lib/banner.js";

test("printWelcomeBanner prints the Kido welcome banner without throwing", () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    printWelcomeBanner();
  } finally {
    console.log = originalLog;
  }
  const output = lines.join("\n");
  assert.match(output, /Welcome to Kido/);
  assert.match(output, /Spec-driven BA\/Dev collaboration for microservices/);
  assert.match(output, /This setup will configure:/);
  assert.match(output, /kido\/docs\/ \+ kido\/changes\/ scaffolding/);
  assert.match(output, /Claude Code skills\/commands under \.claude\//);
  assert.match(output, /Quick start after setup:/);
  assert.match(output, /\/kido:specify\s+->\s+\/kido:apply\s+->\s+\/kido:archive/);
  assert.match(output, /Setting up\.\.\./);
});
