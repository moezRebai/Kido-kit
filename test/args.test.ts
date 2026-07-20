import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, requireFlag, optionalFlag } from "../src/lib/args.js";

test("parses a plain positional command like `new-change <name>` without mistaking it for a subcommand", () => {
  const parsed = parseArgs(["new-change", "Add Swap Pricing", "--type", "feature"]);
  assert.equal(parsed.command, "new-change");
  assert.deepEqual(parsed.positionals, ["Add Swap Pricing"]);
  assert.equal(parsed.flags.type, "feature");
});

test("parses a two-level command (`docs export --to <path>`) as command + positional", () => {
  const parsed = parseArgs(["docs", "export", "--to", "../other-repo"]);
  assert.equal(parsed.command, "docs");
  assert.deepEqual(parsed.positionals, ["export"]);
  assert.equal(parsed.flags.to, "../other-repo");
});

test("boolean flags with no following value default to true", () => {
  const parsed = parseArgs(["archive", "add-swap-pricing", "--force"]);
  assert.deepEqual(parsed.positionals, ["add-swap-pricing"]);
  assert.equal(parsed.flags.force, true);
});

test("a flag value that itself looks like a flag doesn't get swallowed", () => {
  const parsed = parseArgs(["status", "--change", "--not-a-real-value"]);
  // `--not-a-real-value` starts with -- so it's treated as its own flag, not `change`'s value.
  assert.equal(parsed.flags.change, true);
  assert.equal(parsed.flags["not-a-real-value"], true);
});

test("requireFlag throws when missing, returns the value when present", () => {
  assert.throws(() => requireFlag({}, "change"));
  assert.equal(requireFlag({ change: "add-swap-pricing" }, "change"), "add-swap-pricing");
});

test("optionalFlag returns undefined when missing or non-string", () => {
  assert.equal(optionalFlag({}, "type"), undefined);
  assert.equal(optionalFlag({ type: true }, "type"), undefined);
  assert.equal(optionalFlag({ type: "bug" }, "type"), "bug");
});
