import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAskStage } from "../src/skills-content/ask.js";
import { stages } from "../src/pipeline/definition.js";
import type { PipelineStage } from "../src/pipeline/definition.js";

function fakeStage(id: string, description: string): PipelineStage {
  return { id, description, allowedTools: "Read", body: `body for ${id}` };
}

test("buildAskStage sets id and allowedTools", () => {
  const stage = buildAskStage([fakeStage("document", "Builds docs.")]);
  assert.equal(stage.id, "ask");
  assert.equal(stage.allowedTools, "Read");
});

test("buildAskStage's body lists every other stage's command and description", () => {
  const otherStages = [
    fakeStage("document", "Builds docs from existing code."),
    fakeStage("specify", "Forks bug vs feature."),
  ];
  const stage = buildAskStage(otherStages);

  for (const s of otherStages) {
    assert.match(stage.body, new RegExp(`/kido:${s.id}`));
    assert.ok(stage.body.includes(s.description), `body should include ${s.id}'s description verbatim`);
  }
});

test("buildAskStage's body does not include itself", () => {
  const otherStages = [fakeStage("document", "Builds docs.")];
  const stage = buildAskStage(otherStages);
  assert.ok(!stage.body.includes("/kido:ask "), "body should not self-reference in the generated table");
});

test("every real non-ask stage appears in the shipped ask table", () => {
  const ask = stages.find((s) => s.id === "ask")!;
  const others = stages.filter((s) => s.id !== "ask");
  assert.equal(others.length, stages.length - 1);
  for (const s of others) assert.ok(ask.body.includes(s.description), `${s.id} missing from ask table`);
});
