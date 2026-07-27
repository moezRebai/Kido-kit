# Multi-agent renderers (Gemini CLI, Kilo Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `kido init` to generate skills/commands for Gemini CLI and Kilo Code, not just Claude Code, via a generalized renderer registry and an interactive multi-select agent picker.

**Architecture:** `PipelineStage` (`src/pipeline/definition.ts`) stays unchanged — it's already agent-agnostic data. A new `AgentRenderer` interface + `AGENT_RENDERERS` registry (`src/pipeline/renderers/`) replaces the current hardcoded call to the Claude Code renderer in `kido init`. Two new renderer modules (`gemini-cli.ts`, `kilo-code.ts`) join the existing `claude-code.ts`. `kido init` resolves which agents to render for via (in order) an explicit `--agents` flag, an interactive checkbox prompt (new, hand-rolled), or a backward-compatible `["claude"]` default when there's no flag and no TTY.

**Tech Stack:** TypeScript (strict, NodeNext/ESM), Node's built-in `node:test` + `node:assert/strict`, esbuild (build only, no new runtime deps), Node's built-in `readline`/`readline/promises` for terminal I/O.

## Global Constraints

- Zero new runtime dependencies — `package.json`'s `dependencies` must stay empty; hand-roll all new terminal UI, matching the existing `PromptSession` style.
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on (`tsconfig.json`): array/object indexing yields `T | undefined` (use `!` non-null assertions the way `src/lib/args.ts` already does, e.g. `rest[i]!`); optional properties can't be assigned `undefined` explicitly unless the type says so — build option objects by conditionally spreading (`...(cond ? { key: value } : {})`), matching `src/cli.ts`'s existing pattern for `fromLegacy`.
- ESM with `NodeNext` module resolution — internal imports must use explicit `.js` extensions even though source files are `.ts` (e.g. `import { stages } from "../pipeline/definition.js"`).
- Build/test: `npm run build` (esbuild, transpiles `src/` and `test/` into `dist/`, unbundled) then `node --test dist/**/*.test.js` (or a single file: `node --test dist/test/<name>.test.js`). Tests always run against **compiled** `dist/` output — never run `node --test` against `.ts` files directly. `npm test` runs both steps.
- The automated test suite always runs with `stdin.isTTY === false` (Node's `node:test` runner is never a TTY), so **interactive prompt branches are never exercised by automated tests** — this already holds for `askYesNo`/`askText` (see `test/init-jira-setup.test.ts`'s comment: "these tests run in a non-TTY context... that's exactly the behavior worth locking in") and holds the same way for the new `askCheckbox`. Pure logic extracted out of the interactive loop (rendering, key-mapping, state transitions) gets real unit tests; the raw-mode terminal loop itself gets a manual smoke-test checklist instead (final task).
- Non-interactive `kido init` with no `--agents` flag and no TTY must keep generating **only** Claude Code artifacts, byte-for-byte like today — every existing non-interactive test caller depends on this.
- Agent selection is asked on **every** `kido init` run — no persisted "remembered agents" config file (explicit decision made during design).
- Kilo Code gets a command artifact only — no auto-invoke/skill equivalent (explicit decision made during design; see spec's "Out of scope").

---

## Task 1: Renderer registry scaffold + wrap the existing Claude Code renderer

**Files:**
- Create: `src/pipeline/renderers/types.ts`
- Create: `src/pipeline/renderers/registry.ts`
- Modify: `src/pipeline/renderers/claude-code.ts`
- Test: `test/renderers-registry.test.ts`

**Interfaces:**
- Produces: `AgentId = "claude" | "gemini" | "kilo"` (`types.ts`)
- Produces: `AgentRenderer { id: AgentId; label: string; render(stages: PipelineStage[], repoRoot: string): string[] }` (`types.ts`)
- Produces: `claudeCodeRenderer: AgentRenderer` (`claude-code.ts`)
- Produces: `AGENT_RENDERERS: AgentRenderer[]` (`registry.ts`) — contains `claudeCodeRenderer` after this task; Tasks 2 and 3 append to it.

- [ ] **Step 1: Write the failing test**

Create `test/renderers-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/renderers-registry.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline/renderers/registry.js'` (build error, since the file doesn't exist yet — the `npm run build` step itself will fail; that's the expected failure signal here).

- [ ] **Step 3: Write the implementation**

Create `src/pipeline/renderers/types.ts`:

```ts
import type { PipelineStage } from "../definition.js";

export type AgentId = "claude" | "gemini" | "kilo";

export interface AgentRenderer {
  id: AgentId;
  label: string;
  /** Renders every stage for this agent into repoRoot; returns the generated file paths. */
  render(stages: PipelineStage[], repoRoot: string): string[];
}
```

Modify `src/pipeline/renderers/claude-code.ts` — add this import at the top (alongside the existing ones) and this export at the bottom of the file:

```ts
import type { AgentRenderer } from "./types.js";
```

```ts
export const claudeCodeRenderer: AgentRenderer = {
  id: "claude",
  label: "Claude Code",
  render(stages, repoRoot) {
    const claudeDir = join(repoRoot, ".claude");
    renderAllClaudeCodeStages(stages, claudeDir);
    const generated: string[] = [];
    for (const stage of stages) {
      generated.push(join(claudeDir, "skills", `mr-${stage.id}`, "SKILL.md"));
      generated.push(join(claudeDir, "commands", "kido", `${stage.id}.md`));
    }
    return generated;
  },
};
```

Create `src/pipeline/renderers/registry.ts`:

```ts
import type { AgentRenderer } from "./types.js";
import { claudeCodeRenderer } from "./claude-code.js";

export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/renderers-registry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/renderers/types.ts src/pipeline/renderers/registry.ts src/pipeline/renderers/claude-code.ts test/renderers-registry.test.ts
git commit -m "Add AgentRenderer registry, wrap Claude Code renderer to fit it"
```

---

## Task 2: Gemini CLI renderer (skill + command, full parity with Claude Code)

**Files:**
- Create: `src/pipeline/renderers/gemini-cli.ts`
- Modify: `src/pipeline/renderers/registry.ts`
- Test: `test/renderers-gemini.test.ts`

**Interfaces:**
- Consumes: `PipelineStage` (`src/pipeline/definition.ts`), `ensureDir` (`src/lib/fs-utils.ts`), `AgentRenderer` (Task 1's `types.ts`)
- Produces: `renderGeminiCliStage(stage: PipelineStage, geminiDir: string): void`, `renderAllGeminiCliStages(stages: PipelineStage[], geminiDir: string): void`, `geminiCliRenderer: AgentRenderer`

- [ ] **Step 1: Write the failing test**

Create `test/renderers-gemini.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/renderers-gemini.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline/renderers/gemini-cli.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/pipeline/renderers/gemini-cli.ts`:

```ts
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ensureDir } from "../../lib/fs-utils.js";
import type { PipelineStage } from "../definition.js";
import type { AgentRenderer } from "./types.js";

/**
 * Renders a pipeline stage into Gemini CLI's two artifact shapes: a skill
 * (.gemini/skills/mr-<id>/SKILL.md, auto-activated via Gemini CLI's native
 * Agent Skills system — built on the same open standard Claude Code's
 * skills use, including the allowed-tools frontmatter field) and an
 * explicit TOML command (.gemini/commands/kido/<id>.toml, namespaced the
 * same way Claude Code's commands are: "/kido:<id>").
 */
export function renderGeminiCliStage(stage: PipelineStage, geminiDir: string): void {
  const skillName = `mr-${stage.id}`;
  const skillDir = join(geminiDir, "skills", skillName);
  ensureDir(skillDir);

  const skillFrontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${stage.description}`,
    `allowed-tools: ${stage.allowedTools}`,
    "---",
    "",
    "",
  ].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), skillFrontmatter + stage.body, "utf8");

  const commandsDir = join(geminiDir, "commands", "kido");
  ensureDir(commandsDir);
  // TOML literal multi-line strings ('''...''') don't process escapes, so the
  // raw markdown body (quotes, backticks, code fences) can be embedded as-is.
  const toml = [`description = ${JSON.stringify(stage.description)}`, `prompt = '''`, stage.body, `'''`, ""].join(
    "\n"
  );
  writeFileSync(join(commandsDir, `${stage.id}.toml`), toml, "utf8");
}

export function renderAllGeminiCliStages(stages: PipelineStage[], geminiDir: string): void {
  for (const stage of stages) {
    renderGeminiCliStage(stage, geminiDir);
  }
}

export const geminiCliRenderer: AgentRenderer = {
  id: "gemini",
  label: "Gemini CLI",
  render(stages, repoRoot) {
    const geminiDir = join(repoRoot, ".gemini");
    renderAllGeminiCliStages(stages, geminiDir);
    const generated: string[] = [];
    for (const stage of stages) {
      generated.push(join(geminiDir, "skills", `mr-${stage.id}`, "SKILL.md"));
      generated.push(join(geminiDir, "commands", "kido", `${stage.id}.toml`));
    }
    return generated;
  },
};
```

Modify `src/pipeline/renderers/registry.ts`:

```ts
import type { AgentRenderer } from "./types.js";
import { claudeCodeRenderer } from "./claude-code.js";
import { geminiCliRenderer } from "./gemini-cli.js";

export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer, geminiCliRenderer];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/renderers-gemini.test.js`
Expected: PASS

Then run the full suite to confirm Task 1's test still passes: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/renderers/gemini-cli.ts src/pipeline/renderers/registry.ts test/renderers-gemini.test.ts
git commit -m "Add Gemini CLI renderer (skill + command, Agent Skills parity)"
```

---

## Task 3: Kilo Code renderer (command only)

**Files:**
- Create: `src/pipeline/renderers/kilo-code.ts`
- Modify: `src/pipeline/renderers/registry.ts`
- Test: `test/renderers-kilo.test.ts`

**Interfaces:**
- Consumes: `PipelineStage`, `ensureDir`, `AgentRenderer` (same as Task 2)
- Produces: `renderKiloCodeStage(stage: PipelineStage, kiloDir: string): void`, `renderAllKiloCodeStages(stages: PipelineStage[], kiloDir: string): void`, `kiloCodeRenderer: AgentRenderer`

- [ ] **Step 1: Write the failing test**

Create `test/renderers-kilo.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/renderers-kilo.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline/renderers/kilo-code.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/pipeline/renderers/kilo-code.ts`:

```ts
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ensureDir } from "../../lib/fs-utils.js";
import type { PipelineStage } from "../definition.js";
import type { AgentRenderer } from "./types.js";

/**
 * Renders a pipeline stage into Kilo Code's command format
 * (.kilo/commands/kido-<id>.md — the format shared by both Kilo Code's VS
 * Code extension and its standalone CLI). Kilo Code has no auto-invoke
 * mechanism for a narrow single-purpose script the way Claude Code/Gemini
 * CLI skills do (its closest analog, custom modes, is a full persona a user
 * switches into — a structural mismatch for a Kido pipeline stage), so this
 * is the only artifact per stage.
 */
export function renderKiloCodeStage(stage: PipelineStage, kiloDir: string): void {
  const commandsDir = join(kiloDir, "commands");
  ensureDir(commandsDir);
  const frontmatter = ["---", `description: ${stage.description}`, "---", "", ""].join("\n");
  writeFileSync(join(commandsDir, `kido-${stage.id}.md`), frontmatter + stage.body, "utf8");
}

export function renderAllKiloCodeStages(stages: PipelineStage[], kiloDir: string): void {
  for (const stage of stages) {
    renderKiloCodeStage(stage, kiloDir);
  }
}

export const kiloCodeRenderer: AgentRenderer = {
  id: "kilo",
  label: "Kilo Code",
  render(stages, repoRoot) {
    const kiloDir = join(repoRoot, ".kilo");
    renderAllKiloCodeStages(stages, kiloDir);
    return stages.map((stage) => join(kiloDir, "commands", `kido-${stage.id}.md`));
  },
};
```

Modify `src/pipeline/renderers/registry.ts`:

```ts
import type { AgentRenderer } from "./types.js";
import { claudeCodeRenderer } from "./claude-code.js";
import { geminiCliRenderer } from "./gemini-cli.js";
import { kiloCodeRenderer } from "./kilo-code.js";

export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer, geminiCliRenderer, kiloCodeRenderer];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/renderers-kilo.test.js`
Expected: PASS

Then: `npm test` — expect all tests (Tasks 1-3 plus every pre-existing test) to PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/renderers/kilo-code.ts src/pipeline/renderers/registry.ts test/renderers-kilo.test.ts
git commit -m "Add Kilo Code renderer (command only, no auto-invoke equivalent)"
```

---

## Task 4: `parseAgentsFlag` — validate and expand the `--agents` CLI value

**Files:**
- Create: `src/commands/init-agents.ts`
- Test: `test/init-agents.test.ts`

**Interfaces:**
- Consumes: `AgentId`, `AGENT_RENDERERS` (Tasks 1-3)
- Produces: `parseAgentsFlag(value: string): AgentId[]`

- [ ] **Step 1: Write the failing test**

Create `test/init-agents.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentsFlag } from "../src/commands/init-agents.js";

test("parses a comma-separated list into agent ids", () => {
  assert.deepEqual(parseAgentsFlag("claude,gemini"), ["claude", "gemini"]);
});

test("trims whitespace around each id", () => {
  assert.deepEqual(parseAgentsFlag(" claude , kilo "), ["claude", "kilo"]);
});

test("\"all\" expands to every registered agent id", () => {
  assert.deepEqual(parseAgentsFlag("all"), ["claude", "gemini", "kilo"]);
});

test("is case-insensitive for \"all\"", () => {
  assert.deepEqual(parseAgentsFlag("ALL"), ["claude", "gemini", "kilo"]);
});

test("throws with a helpful message on an unknown id", () => {
  assert.throws(() => parseAgentsFlag("claude,made-up"), /Unknown agent "made-up"/);
});

test("throws on an empty value", () => {
  assert.throws(() => parseAgentsFlag(""), /requires at least one id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/init-agents.test.js`
Expected: FAIL — `Cannot find module '../src/commands/init-agents.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/commands/init-agents.ts`:

```ts
import type { AgentId } from "../pipeline/renderers/types.js";
import { AGENT_RENDERERS } from "../pipeline/renderers/registry.js";

const KNOWN_AGENT_IDS: AgentId[] = AGENT_RENDERERS.map((r) => r.id);

/** Parses --agents's value ("claude,gemini" or "all") into validated AgentIds. */
export function parseAgentsFlag(value: string): AgentId[] {
  if (value.trim().toLowerCase() === "all") {
    return [...KNOWN_AGENT_IDS];
  }

  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (ids.length === 0) {
    throw new Error(`--agents requires at least one id (${KNOWN_AGENT_IDS.join(", ")}) or "all"`);
  }

  for (const id of ids) {
    if (!KNOWN_AGENT_IDS.includes(id as AgentId)) {
      throw new Error(`Unknown agent "${id}" in --agents — valid ids: ${KNOWN_AGENT_IDS.join(", ")}, or "all"`);
    }
  }

  return ids as AgentId[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/init-agents.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/init-agents.ts test/init-agents.test.ts
git commit -m "Add parseAgentsFlag for kido init's --agents value"
```

---

## Task 5: Checkbox prompt — pure helpers + `PromptSession.askCheckbox`

**Files:**
- Create: `src/lib/checkbox.ts`
- Modify: `src/lib/prompt.ts`
- Test: `test/checkbox.test.ts`

**Interfaces:**
- Produces (`checkbox.ts`): `CheckboxChoice<T extends string> { id: T; label: string }`, `CheckboxState<T extends string> { cursorIndex: number; selected: Set<T> }`, `CheckboxAction = "up" | "down" | "toggle" | "confirm" | "cancel"`, `Keypress { name?: string; sequence?: string; ctrl?: boolean }`, `renderCheckboxList<T extends string>(question: string, choices: CheckboxChoice<T>[], selected: ReadonlySet<T>, cursorIndex: number): string`, `keyToCheckboxAction(key: Keypress | undefined): CheckboxAction | undefined`, `applyCheckboxAction<T extends string>(state: CheckboxState<T>, action: CheckboxAction, choices: CheckboxChoice<T>[]): CheckboxState<T>`
- Produces (`prompt.ts`): `PromptSession.askCheckbox<T extends string>(question: string, choices: CheckboxChoice<T>[], defaultSelected: T[]): Promise<T[]>`

This task keeps the raw-mode terminal loop thin by extracting everything decidable-without-a-terminal into pure, directly-testable functions (rendering the list as text, mapping a keypress to an action, applying an action to state). Only the actual stdin listening/raw-mode toggling in `askCheckbox` itself is untested by `node:test` (per Global Constraints) — it gets a manual smoke test in Task 8.

- [ ] **Step 1: Write the failing test**

Create `test/checkbox.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderCheckboxList,
  keyToCheckboxAction,
  applyCheckboxAction,
  type CheckboxChoice,
  type CheckboxState,
} from "../src/lib/checkbox.js";

const choices: CheckboxChoice<"a" | "b" | "c">[] = [
  { id: "a", label: "Option A" },
  { id: "b", label: "Option B" },
  { id: "c", label: "Option C" },
];

test("renderCheckboxList marks the selected choices and the cursor row", () => {
  const output = renderCheckboxList("Pick some:", choices, new Set(["b"]), 1);
  const lines = output.split("\n");
  assert.equal(lines[0], "Pick some:");
  assert.equal(lines[1], "  [ ] Option A");
  assert.equal(lines[2], "> [x] Option B");
  assert.equal(lines[3], "  [ ] Option C");
});

test("keyToCheckboxAction maps arrow keys, space, enter, and ctrl+c", () => {
  assert.equal(keyToCheckboxAction({ name: "up" }), "up");
  assert.equal(keyToCheckboxAction({ name: "down" }), "down");
  assert.equal(keyToCheckboxAction({ name: "space", sequence: " " }), "toggle");
  assert.equal(keyToCheckboxAction({ name: "return" }), "confirm");
  assert.equal(keyToCheckboxAction({ name: "c", ctrl: true }), "cancel");
  assert.equal(keyToCheckboxAction({ name: "a" }), undefined);
  assert.equal(keyToCheckboxAction(undefined), undefined);
});

test("applyCheckboxAction moves the cursor with wraparound and toggles selection", () => {
  const state: CheckboxState<"a" | "b" | "c"> = { cursorIndex: 0, selected: new Set() };

  const movedUp = applyCheckboxAction(state, "up", choices);
  assert.equal(movedUp.cursorIndex, 2, "up from index 0 should wrap to the last choice");

  const movedDown = applyCheckboxAction(state, "down", choices);
  assert.equal(movedDown.cursorIndex, 1);

  const toggled = applyCheckboxAction(state, "toggle", choices);
  assert.deepEqual([...toggled.selected], ["a"]);

  const toggledAgain = applyCheckboxAction(toggled, "toggle", choices);
  assert.deepEqual([...toggledAgain.selected], []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/checkbox.test.js`
Expected: FAIL — `Cannot find module '../src/lib/checkbox.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/checkbox.ts`:

```ts
export interface CheckboxChoice<T extends string> {
  id: T;
  label: string;
}

export interface CheckboxState<T extends string> {
  cursorIndex: number;
  selected: Set<T>;
}

export type CheckboxAction = "up" | "down" | "toggle" | "confirm" | "cancel";

export interface Keypress {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

/** Renders the current checkbox state as the multi-line text to print to the terminal. */
export function renderCheckboxList<T extends string>(
  question: string,
  choices: CheckboxChoice<T>[],
  selected: ReadonlySet<T>,
  cursorIndex: number
): string {
  const lines = [question];
  choices.forEach((choice, i) => {
    const box = selected.has(choice.id) ? "[x]" : "[ ]";
    const cursor = i === cursorIndex ? ">" : " ";
    lines.push(`${cursor} ${box} ${choice.label}`);
  });
  return lines.join("\n");
}

/** Maps a Node readline keypress event to a checkbox action, or undefined for keys we ignore. */
export function keyToCheckboxAction(key: Keypress | undefined): CheckboxAction | undefined {
  if (!key) return undefined;
  if (key.ctrl && key.name === "c") return "cancel";
  if (key.name === "up") return "up";
  if (key.name === "down") return "down";
  if (key.name === "return") return "confirm";
  if (key.name === "space" || key.sequence === " ") return "toggle";
  return undefined;
}

/** Pure state transition: applies one action to the current checkbox state. */
export function applyCheckboxAction<T extends string>(
  state: CheckboxState<T>,
  action: CheckboxAction,
  choices: CheckboxChoice<T>[]
): CheckboxState<T> {
  const selected = new Set(state.selected);
  let cursorIndex = state.cursorIndex;

  if (action === "up") cursorIndex = (cursorIndex - 1 + choices.length) % choices.length;
  if (action === "down") cursorIndex = (cursorIndex + 1) % choices.length;
  if (action === "toggle") {
    const id = choices[cursorIndex]!.id;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  return { cursorIndex, selected };
}
```

Modify `src/lib/prompt.ts`. Change `private readonly rl: readline.Interface;` to `private rl: readline.Interface;` (it needs to be reassignable — see below). Add these imports at the top:

```ts
import { emitKeypressEvents } from "node:readline";
import {
  renderCheckboxList,
  keyToCheckboxAction,
  applyCheckboxAction,
  type CheckboxChoice,
  type CheckboxState,
  type Keypress,
} from "./checkbox.js";
```

Add this method inside the `PromptSession` class, after `askText`:

```ts
  async askCheckbox<T extends string>(
    question: string,
    choices: CheckboxChoice<T>[],
    defaultSelected: T[]
  ): Promise<T[]> {
    // readline's own Interface attaches its own 'keypress' listener to stdin
    // (for line-editing/history) as soon as it's constructed. If it stayed
    // attached while we read raw single keys below, both listeners would
    // react to the same keypress and corrupt the terminal. Closing it here
    // detaches that listener; a fresh Interface is created in `finally` so
    // askYesNo/askText keep working on any later call.
    this.rl.close();

    let state: CheckboxState<T> = { cursorIndex: 0, selected: new Set(defaultSelected) };
    const render = () => renderCheckboxList(question, choices, state.selected, state.cursorIndex);
    const linesDrawn = choices.length + 1;

    stdout.write(render() + "\n");

    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw ?? false;
    if (stdin.setRawMode) stdin.setRawMode(true);

    try {
      return await new Promise<T[]>((resolve) => {
        const onKeypress = (_str: string, key: Keypress) => {
          const action = keyToCheckboxAction(key);
          if (!action) return;
          if (action === "cancel" || action === "confirm") {
            stdin.off("keypress", onKeypress);
            resolve([...state.selected]);
            return;
          }
          state = applyCheckboxAction(state, action, choices);
          stdout.write(`\x1B[${linesDrawn}A`);
          for (let i = 0; i < linesDrawn; i++) stdout.write("\x1B[2K\n");
          stdout.write(`\x1B[${linesDrawn}A`);
          stdout.write(render() + "\n");
        };
        stdin.on("keypress", onKeypress);
      });
    } finally {
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      this.rl = readline.createInterface({ input: stdin, output: stdout });
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/checkbox.test.js`
Expected: PASS

Then: `npm run typecheck` — expect no errors (this exercises `prompt.ts`'s new method even though nothing calls it yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkbox.ts src/lib/prompt.ts test/checkbox.test.ts
git commit -m "Add PromptSession.askCheckbox, backed by pure render/key/state helpers"
```

---

## Task 6: Wire agent selection into `kido init`

**Files:**
- Modify: `src/commands/init.ts`
- Test: `test/init.test.ts`

**Interfaces:**
- Consumes: `AGENT_RENDERERS`, `AgentId` (Tasks 1-3), `PromptSession.askCheckbox` (Task 5)
- Produces: `InitOptions.agents?: AgentId[]` (new optional field; `runInit`'s resolution behavior described below)

**Resolution order inside `runInit`** (matches the design spec):
1. `options.agents` provided and non-empty → used directly (this is what the CLI passes after `parseAgentsFlag` validates it in Task 7 — `runInit` itself does no validation, it trusts already-validated `AgentId[]`).
2. No `options.agents`, TTY present → interactive checkbox, Claude Code pre-checked, Gemini CLI/Kilo Code unchecked.
3. No `options.agents`, no TTY → `["claude"]` (today's exact behavior).

- [ ] **Step 1: Write the failing tests**

Add these test cases to `test/init.test.ts` (append after the existing tests, keep all existing tests unchanged — they must keep passing):

```ts
test("--agents claude,gemini generates both trees and nothing under .kilo", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true, agents: ["claude", "gemini"] });

    assert.equal(existsSync(join(repo, ".claude", "skills", "mr-document", "SKILL.md")), true);
    assert.equal(existsSync(join(repo, ".gemini", "skills", "mr-document", "SKILL.md")), true);
    assert.equal(existsSync(join(repo, ".kilo")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--agents kilo generates only the .kilo commands tree", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true, agents: ["kilo"] });

    assert.equal(existsSync(join(repo, ".kilo", "commands", "kido-document.md")), true);
    assert.equal(existsSync(join(repo, ".claude")), false);
    assert.equal(existsSync(join(repo, ".gemini")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("no --agents and no TTY still defaults to Claude Code only (backward compatible)", async () => {
  const repo = makeEmptyRepo();
  try {
    await runInit(repo, { noLegacy: true });

    assert.equal(existsSync(join(repo, ".claude", "skills", "mr-document", "SKILL.md")), true);
    assert.equal(existsSync(join(repo, ".gemini")), false);
    assert.equal(existsSync(join(repo, ".kilo")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/test/init.test.js`
Expected: the two new `--agents`-based tests FAIL with a TypeScript build error first (`InitOptions` has no `agents` property yet), so the build itself won't succeed — that's the expected failure signal.

- [ ] **Step 3: Write the implementation**

In `src/commands/init.ts`, replace the import block at the top. Remove this line (no longer needed — rendering now goes through the registry):

```ts
import { renderAllClaudeCodeStages } from "../pipeline/renderers/claude-code.js";
```

Also remove the now-unused `join` import if nothing else in the file uses it — check first (`grep -n "join(" src/commands/init.ts`; if only the removed `claudeDir` line used it, delete `import { join } from "node:path";` too).

Add these imports:

```ts
import { AGENT_RENDERERS } from "../pipeline/renderers/registry.js";
import type { AgentId } from "../pipeline/renderers/types.js";
```

Update `InitOptions`:

```ts
export interface InitOptions {
  /** Non-interactive: seed kido/docs/ from this legacy repo path (decision #59, --from-legacy). */
  fromLegacy?: string;
  /** Non-interactive: skip the legacy-docs question entirely, same as answering "no". */
  noLegacy?: boolean;
  /** Non-interactive: skip the Jira credentials question entirely. */
  skipJiraSetup?: boolean;
  /** Non-interactive: which agents to generate skills/commands for. Already validated (see parseAgentsFlag). */
  agents?: AgentId[];
}
```

Add this new function (place it above `runInit`, after `handleJiraSetup`):

```ts
async function resolveSelectedAgents(
  explicit: AgentId[] | undefined,
  prompt: PromptSession | undefined
): Promise<AgentId[]> {
  if (explicit && explicit.length > 0) return explicit;

  if (!prompt) return ["claude"];

  const choices = AGENT_RENDERERS.map((r) => ({ id: r.id, label: r.label }));
  return prompt.askCheckbox(
    "Which agent(s) do you want to generate skills/commands for? (space to toggle, enter to confirm)",
    choices,
    ["claude"]
  );
}
```

Replace the body of `runInit` with:

```ts
export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  printWelcomeBanner();

  const paths = resolveKidoPaths(repoRoot);

  ensureDir(paths.docsDir);
  ensureDir(paths.changesDir);
  ensureDir(paths.archiveDir);

  // Interactive prompts only when stdin is a real terminal — piped/non-TTY
  // input can race ahead of sequential readline question() calls (a known
  // Node gotcha), so scripted/automated callers should use the non-interactive
  // flags (--from-legacy/--no-legacy/--skip-jira-setup/--agents) instead.
  const prompt = stdin.isTTY ? new PromptSession() : undefined;
  try {
    const selectedAgentIds = await resolveSelectedAgents(options.agents, prompt);
    for (const agentId of selectedAgentIds) {
      const renderer = AGENT_RENDERERS.find((r) => r.id === agentId)!;
      renderer.render(stages, repoRoot);
    }
    const selectedLabels = selectedAgentIds
      .map((id) => AGENT_RENDERERS.find((r) => r.id === id)!.label)
      .join(", ");
    console.log(`Scaffolded kido/ in ${repoRoot}`);
    console.log(`Generated skills/commands for ${selectedLabels} (stages: ${stages.map((s) => s.id).join(", ")})`);

    await handleDocsSetup(repoRoot, options, prompt);
    await handleJiraSetup(repoRoot, options, prompt);
  } finally {
    prompt?.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/test/init.test.js`
Expected: PASS — including every pre-existing test in that file, unmodified.

Then: `npm test` — expect the full suite to PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts test/init.test.ts
git commit -m "Wire agent selection (--agents / checkbox / default) into kido init"
```

---

## Task 7: `--agents` CLI flag wiring + HELP text

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `parseAgentsFlag` (Task 4)

- [ ] **Step 1: Update the HELP text**

In `src/cli.ts`, change:

```ts
  kido init [--from-legacy <path> | --no-legacy] [--skip-jira-setup]  Scaffold kido/ and generate Claude Code skills/commands
```

to:

```ts
  kido init [--from-legacy <path> | --no-legacy] [--skip-jira-setup] [--agents <ids>]  Scaffold kido/ and generate agent skills/commands (ids: claude, gemini, kilo, or "all"; comma-separated; asks interactively if omitted and a TTY is present)
```

- [ ] **Step 2: Wire the flag**

Add the import:

```ts
import { parseAgentsFlag } from "./commands/init-agents.js";
```

Change the `init` case from:

```ts
    case "init":
      await runInit(repoRoot, {
        ...(typeof flags["from-legacy"] === "string" ? { fromLegacy: flags["from-legacy"] } : {}),
        noLegacy: Boolean(flags["no-legacy"]),
        skipJiraSetup: Boolean(flags["skip-jira-setup"]),
      });
      break;
```

to:

```ts
    case "init":
      await runInit(repoRoot, {
        ...(typeof flags["from-legacy"] === "string" ? { fromLegacy: flags["from-legacy"] } : {}),
        noLegacy: Boolean(flags["no-legacy"]),
        skipJiraSetup: Boolean(flags["skip-jira-setup"]),
        ...(typeof flags["agents"] === "string" ? { agents: parseAgentsFlag(flags["agents"]) } : {}),
      });
      break;
```

- [ ] **Step 3: Run the full suite and typecheck**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all tests PASS (this task has no new automated test of its own — `parseAgentsFlag` is already covered in Task 4, and this step is pure wiring; verify by hand in Task 8's manual checklist with a real `kido init --agents gemini` invocation).

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "Wire --agents flag into kido init's CLI entry point"
```

---

## Task 8: Docs updates (README.md, DESIGN.md)

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update `README.md`**

In the "Quick start" section, change:

```
This scaffolds `kido/docs/` + `kido/changes/`, generates six Claude Code skills/commands under `.claude/`, and offers to seed `kido/docs/` from a legacy repo or set up Jira credentials (Cloud or Server/Data Center).
```

to:

```
This scaffolds `kido/docs/` + `kido/changes/`, asks which agent(s) you want to generate skills/commands for (Claude Code, Gemini CLI, Kilo Code — checkbox, space to toggle; pass `--agents claude,gemini` or `--agents all` to skip the prompt), and offers to seed `kido/docs/` from a legacy repo or set up Jira credentials (Cloud or Server/Data Center).
```

Add a row to the CLI reference table (after the `kido init` row):

```
| `kido init [--agents <ids>]` | Scaffold `kido/` + generate skills/commands for the chosen agent(s) (`claude`, `gemini`, `kilo`, or `all`). |
```

(Replace the existing `kido init` row rather than duplicating it.)

- [ ] **Step 2: Update `DESIGN.md`**

In "Scope explicitly excluded from v1", remove this line entirely:

```
- Gemini CLI / Kilo Code renderers (architecture supports adding them later) — Claude Code only for now.
```

In "Package & build", change:

```
- v1 targets **Claude Code only** for generated skills/commands, but the internal pipeline definition (`src/pipeline/definition.ts`) stays agent-agnostic (`{name, description, prompt body, required tools, args}` per stage) behind a renderer interface (`src/pipeline/renderers/`), so Gemini CLI/Kilo Code support can be added later as new renderers without touching the core.
```

to:

```
- Generated skills/commands target **Claude Code, Gemini CLI, and Kilo Code**, chosen per `kido init` run via an interactive checkbox (or the `--agents` flag) — no selection is persisted, so each run asks again. The internal pipeline definition (`src/pipeline/definition.ts`) stays agent-agnostic (`{id, description, allowedTools, body}` per stage) behind a renderer interface (`src/pipeline/renderers/`): Claude Code and Gemini CLI each get an auto-invoke skill (`mr-<id>/SKILL.md`) plus an explicit command (`/kido:<id>`); Kilo Code gets a command only (`/kido-<id>`), since it has no auto-invoke mechanism for a narrow single-purpose script.
```

In the repo-side file layout code block, change:

```
└── .claude/
    ├── skills/mr-*/SKILL.md                  # generated, orchestration logic (auto-invokable by the model)
    └── commands/kido/*.md                    # generated, explicit invocation (/kido:*)
```

to:

```
├── .claude/                                  # generated if Claude Code is selected
│   ├── skills/mr-*/SKILL.md                  # orchestration logic (auto-invokable by the model)
│   └── commands/kido/*.md                    # explicit invocation (/kido:*)
├── .gemini/                                  # generated if Gemini CLI is selected
│   ├── skills/mr-*/SKILL.md                  # orchestration logic (Gemini's native Agent Skills, auto-activated)
│   └── commands/kido/*.toml                  # explicit invocation (/kido:*)
└── .kilo/                                    # generated if Kilo Code is selected
    └── commands/kido-*.md                    # explicit invocation only (/kido-*) — no auto-invoke equivalent
```

- [ ] **Step 3: Commit**

```bash
git add README.md DESIGN.md
git commit -m "Update README/DESIGN docs for multi-agent kido init"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full automated test suite**

Run: `npm test`
Expected: every test passes, including all pre-existing tests (no regressions) and every test added in Tasks 1-6.

- [ ] **Step 3: Manual smoke test — interactive checkbox**

In a real terminal (not through this session's tooling, which isn't a TTY):

```bash
npm link   # if not already linked
cd /path/to/some/test/repo
kido init
```

Verify: the checkbox prompt appears with Claude Code pre-checked; pressing the down arrow moves the cursor; pressing space toggles Gemini CLI and/or Kilo Code on; pressing enter confirms and generates only the checked agents' trees (inspect `.claude/`, `.gemini/`, `.kilo/` under the test repo accordingly); Ctrl+C during the prompt exits cleanly without corrupting the terminal (cursor visible, shell prompt usable afterward).

- [ ] **Step 4: Manual smoke test — non-interactive flag**

```bash
kido init --agents gemini,kilo --no-legacy --skip-jira-setup
```

Verify: no prompt appears; `.gemini/` and `.kilo/` are generated; `.claude/` is not created.

```bash
kido init --agents made-up --no-legacy --skip-jira-setup
```

Verify: exits with the `Unknown agent "made-up"` error message from `parseAgentsFlag`, no files written.

- [ ] **Step 5: Manual content check — one stage, all three agents**

Pick one stage (e.g. `document`) and open all four generated files for it side by side:
`.claude/commands/kido/document.md`, `.gemini/commands/kido/document.toml`, `.gemini/skills/mr-document/SKILL.md`,
`.kilo/commands/kido-document.md`. Confirm the orchestration body text is identical across all of them (only the
frontmatter/wrapper format differs), and that the Gemini `.toml` file is valid TOML (no stray quote/escaping
issues) by running `gemini` (if installed) or eyeballing it against the TOML spec's literal-string rules.

- [ ] **Step 6: Real-tool verification, if available (flagged risk from the design spec)**

The Gemini CLI and Kilo Code formats in this plan were confirmed against each tool's docs at design time, not
against a locally running copy of either tool — there's no SDK/schema to catch a future format drift given
Kido's zero-runtime-dependency policy. If Gemini CLI and/or Kilo Code are installed in the environment executing
this plan, open the generated test repo in each and confirm: the `/kido:document` (Gemini) or `/kido-document`
(Kilo) command actually appears and runs without a parse error, and — for Gemini specifically — that the
`mr-document` skill is listed as discovered (e.g. via whatever skill-listing command that version of Gemini CLI
exposes). If neither tool is installed in this environment, note that explicitly instead of skipping silently,
so a human with access to those tools knows this step still needs doing before the feature is considered fully
verified.
