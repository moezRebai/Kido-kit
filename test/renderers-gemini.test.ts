import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAllGeminiCliStages } from "../src/pipeline/renderers/gemini-cli.js";
import { AGENT_RENDERERS } from "../src/pipeline/renderers/registry.js";
import { stages } from "../src/pipeline/definition.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-gemini-"));
}

test("renders a SKILL.md and a .toml command for every stage", () => {
  const repo = makeTmpDir();
  try {
    const geminiDir = join(repo, ".gemini");
    renderAllGeminiCliStages(stages, geminiDir);

    for (const stage of stages) {
      const skillPath = join(geminiDir, "skills", `mr-${stage.id}`, "SKILL.md");
      assert.equal(existsSync(skillPath), true, `${skillPath} should exist`);
      const skillContent = readFileSync(skillPath, "utf8");
      assert.match(skillContent, /^---\n/);
      assert.ok(skillContent.includes(`name: mr-${stage.id}`));
      assert.ok(skillContent.includes(`allowed-tools: ${stage.allowedTools}`));
      assert.ok(skillContent.includes(stage.body));

      const commandPath = join(geminiDir, "commands", "kido", `${stage.id}.toml`);
      assert.equal(existsSync(commandPath), true, `${commandPath} should exist`);
      const commandContent = readFileSync(commandPath, "utf8");
      assert.match(commandContent, /^description = /);
      assert.ok(commandContent.includes("prompt = '''"));
      assert.ok(commandContent.includes(stage.body));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("AGENT_RENDERERS includes the gemini renderer", () => {
  const repo = makeTmpDir();
  try {
    const gemini = AGENT_RENDERERS.find((r) => r.id === "gemini");
    assert.ok(gemini, "gemini renderer should be registered");
    assert.equal(gemini!.label, "Gemini CLI");

    const generated = gemini!.render(stages, repo);
    assert.equal(existsSync(join(repo, ".gemini", "skills", "mr-document", "SKILL.md")), true);
    assert.equal(existsSync(join(repo, ".gemini", "commands", "kido", "document.toml")), true);
    assert.equal(generated.length, stages.length * 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
