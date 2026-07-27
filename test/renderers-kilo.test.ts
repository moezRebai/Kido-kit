import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAllKiloCodeStages } from "../src/pipeline/renderers/kilo-code.js";
import { AGENT_RENDERERS } from "../src/pipeline/renderers/registry.js";
import { stages } from "../src/pipeline/definition.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-kilo-"));
}

test("renders one command markdown file per stage, no skill directory", () => {
  const repo = makeTmpDir();
  try {
    const kiloDir = join(repo, ".kilo");
    renderAllKiloCodeStages(stages, kiloDir);

    for (const stage of stages) {
      const commandPath = join(kiloDir, "commands", `kido-${stage.id}.md`);
      assert.equal(existsSync(commandPath), true, `${commandPath} should exist`);
      const content = readFileSync(commandPath, "utf8");
      assert.match(content, /^---\n/);
      assert.ok(content.includes(`description: ${stage.description}`));
      assert.ok(content.includes(stage.body));
    }

    assert.equal(existsSync(join(kiloDir, "skills")), false, "Kilo Code has no auto-invoke skill artifact");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("AGENT_RENDERERS includes the kilo renderer", () => {
  const repo = makeTmpDir();
  try {
    const kilo = AGENT_RENDERERS.find((r) => r.id === "kilo");
    assert.ok(kilo, "kilo renderer should be registered");
    assert.equal(kilo!.label, "Kilo Code");

    const generated = kilo!.render(stages, repo);
    assert.equal(existsSync(join(repo, ".kilo", "commands", "kido-document.md")), true);
    assert.equal(generated.length, stages.length);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
