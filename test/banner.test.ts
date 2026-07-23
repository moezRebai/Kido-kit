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

test("printWelcomeBanner respects NO_COLOR and isTTY for ANSI color output", () => {
  const originalLog = console.log;
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  try {
    // Test 1: With TTY and no NO_COLOR, output should contain ANSI escape sequences
    process.stdout.isTTY = true;
    delete process.env.NO_COLOR;

    const linesWithColor: string[] = [];
    console.log = (...args: unknown[]) => {
      linesWithColor.push(args.map(String).join(" "));
    };
    printWelcomeBanner();

    const outputWithColor = linesWithColor.join("\n");
    assert.ok(
      outputWithColor.includes("\x1b["),
      "Output should contain ANSI escape sequences when isTTY=true and NO_COLOR undefined"
    );

    // Test 2: With NO_COLOR set, output should NOT contain ANSI escape sequences
    process.env.NO_COLOR = "1";

    const linesWithoutColor: string[] = [];
    console.log = (...args: unknown[]) => {
      linesWithoutColor.push(args.map(String).join(" "));
    };
    printWelcomeBanner();

    const outputWithoutColor = linesWithoutColor.join("\n");
    assert.ok(
      !outputWithoutColor.includes("\x1b["),
      "Output should NOT contain ANSI escape sequences when NO_COLOR is set"
    );
  } finally {
    console.log = originalLog;
    process.stdout.isTTY = originalIsTTY;
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }
});
