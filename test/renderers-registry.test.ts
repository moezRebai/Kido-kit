import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_RENDERERS } from "../src/pipeline/renderers/registry.js";
import { stages } from "../src/pipeline/definition.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-renderers-"));
}

test("AGENT_RENDERERS includes the claude renderer, which renders every stage's skill and command", () => {
  const repo = makeTmpDir();
  try {
    const claude = AGENT_RENDERERS.find((r) => r.id === "claude");
    assert.ok(claude, "claude renderer should be registered");
    assert.equal(claude!.label, "Claude Code");

    const generated = claude!.render(stages, repo);

    assert.equal(existsSync(join(repo, ".claude", "skills", "mr-document", "SKILL.md")), true);
    assert.equal(existsSync(join(repo, ".claude", "commands", "kido", "document.md")), true);
    assert.equal(generated.length, stages.length * 2, "should report 2 generated paths per stage");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
