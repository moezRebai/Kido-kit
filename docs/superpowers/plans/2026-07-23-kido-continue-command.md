# `/kido:continue` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/kido:continue` pipeline stage that reports where an in-flight change stands (which artifacts exist, whether it's synced to Jira, how many tasks are implemented) and tells the user — or offers to launch — the next command in the pipeline.

**Architecture:** A seventh entry in the existing agent-agnostic pipeline-stage list (`src/pipeline/definition.ts`), defined as pure prompt content in a new `src/skills-content/continue.ts`, rendered by the existing Claude Code renderer into `.claude/skills/mr-continue/SKILL.md` and `.claude/commands/kido/continue.md` exactly like the other six stages. No new CLI subcommand, no new runtime code, no new state file — it's read-only reasoning over signals the pipeline already writes (artifact presence via `kido status`, `.kido-meta.json`, frontmatter `jiraId`/`epicId`, `tasks.md` content).

**Tech Stack:** TypeScript (ESM, Node 20+), esbuild (unbundled transpile for tests), `node:test` + `node:assert/strict`.

## Global Constraints

- Follow the existing `PipelineStage` shape exactly (`id`, `description`, `allowedTools`, `body`) — see `src/pipeline/definition.ts:7-16`.
- `body` is a single template-literal markdown string, same style/voice as the other five `src/skills-content/*.ts` files (imperative, second-person-to-the-agent, no code fences except where quoting literal file formats).
- This stage is **read-only**: it must never write or modify any artifact, frontmatter, or Jira state. Say so explicitly in the body's guardrails.
- No git shell-outs, no live Jira API calls — detection uses only `kido status`, `.kido-meta.json`, frontmatter, and `tasks.md` content already on disk. This is a deliberate scope decision from the design doc, not an oversight.
- Reuses the fork logic `/kido:specify` (functional-spec → checkpoint → design; bug path; existing-Epic path), `/kido:tasks`, and `/kido:apply` already encode — don't invent new branching rules.
- Spec: `docs/superpowers/specs/2026-07-23-kido-continue-command-design.md` — this plan implements it in full; re-read it if anything below is ambiguous.

---

### Task 1: Add the `continue` pipeline stage

**Files:**
- Create: `src/skills-content/continue.ts`
- Modify: `src/pipeline/definition.ts`
- Modify: `test/init.test.ts:13-39` (the `kido init scaffolds...` test)

**Interfaces:**
- Consumes: `PipelineStage` type from `src/pipeline/definition.ts` (`{ id: string; description: string; allowedTools: string; body: string }`) — same shape every other `skills-content/*.ts` file exports.
- Produces: `continueStage: PipelineStage` (named export, `id: "continue"`), imported and appended to the `stages` array in `src/pipeline/definition.ts` so `renderAllClaudeCodeStages` (called from `kido init`) generates `.claude/skills/mr-continue/SKILL.md` and `.claude/commands/kido/continue.md`. No other task in this plan depends on this one — it's the only task.

- [ ] **Step 1: Write the failing test**

Extend the existing scaffolding test to expect the new skill/command files. Edit `test/init.test.ts`, replacing the two `assert.deepEqual` blocks inside the `"kido init scaffolds kido/docs, kido/changes, kido/changes/archive, and .claude skills+commands"` test (currently lines 26-35):

```typescript
    const skillDirs = readdirSync(join(repo, ".claude", "skills"));
    // Deliberately a different prefix than the /kido:* commands below — see
    // claude-code.ts's renderer doc comment for why (picker-collision fix).
    assert.deepEqual(
      skillDirs.sort(),
      ["mr-apply", "mr-archive", "mr-continue", "mr-document", "mr-review", "mr-specify", "mr-tasks"].sort()
    );

    const commandFiles = readdirSync(join(repo, ".claude", "commands", "kido"));
    assert.deepEqual(
      commandFiles.sort(),
      ["apply.md", "archive.md", "continue.md", "document.md", "review.md", "specify.md", "tasks.md"].sort()
    );
```

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`
Expected: FAIL — the `kido init scaffolds...` test in `test/init.test.ts` fails its first (or second) `assert.deepEqual`, reporting the actual `skillDirs`/`commandFiles` arrays are missing `"mr-continue"` / `"continue.md"` compared to the now-updated expected arrays.

- [ ] **Step 3: Create `src/skills-content/continue.ts`**

```typescript
import type { PipelineStage } from "../pipeline/definition.js";

const body = `Report where a change stands in the pipeline and what to do next. Read-only — this never writes or modifies any artifact, frontmatter, or Jira state. Safe to run at any point in any change's lifecycle, purely to answer "what's next?" after picking work back up, possibly days later.

**Store selection:** resolve the repo root (walk up for \`kido/\`).

## Step 1 — Pick the change

- **If the user names a change** (as a command argument or in their message, e.g. "continue swap-pricing") — look it up directly: check \`kido/changes/<name>/\` first, then \`kido/changes/archive/<name>/\` if it's not there. Skip straight to Step 2 for that name — or, if it's only found under \`archive/\`, report it's already archived and stop; there's nothing to continue.
- **Otherwise**, \`Glob\` for \`kido/changes/*/\` (excluding \`kido/changes/archive/\`):
  - **Zero changes** → say so plainly, point at \`/kido:specify\` to start one. Stop here.
  - **One change** → use it, but name it out loud (e.g. "Found one in-flight change: \`swap-pricing\`.") — never silently assume which one without saying so.
  - **Multiple changes** → run Step 2 for each, condensed to one line (name + coarse stage label, e.g. "functional-spec only", "tasks synced, 2/5 implemented"). Present the list and ask via \`AskUserQuestion\` which one to continue before giving detailed guidance on any single one.

## Step 2 — Detect the stage

Reuses the same forks \`/kido:specify\`, \`/kido:tasks\`, and \`/kido:apply\` already use (bug path, existing-Epic/single-Story path, full new-Epic feature path) — read the same signals those stages already produce rather than inventing new rules:

1. Run \`kido status --change <name>\` for artifact presence (\`functional-spec.md\`/\`design.md\`/\`tasks.md\`, or \`bug.md\`).
2. Read \`.kido-meta.json\` in the change dir for \`type\` (\`feature\`/\`bug\`).
3. Read frontmatter on \`functional-spec.md\` (feature) or \`bug.md\` (bug): \`jiraId\` (already pushed to Jira?), \`epicId\` (existing-Epic mode — files as a single Story, skips \`/kido:tasks\` entirely).
4. If \`tasks.md\` exists, read it: count \`## Task N:\` headings total, and how many have a \`**Jira:**\` marker line (synced to Jira as a Story). Also look for a completion marker near each heading (Dev checks tasks off during \`/kido:apply\`, but the exact marker isn't standardized across this codebase) — if you find one applied consistently, count done vs. total; if you don't find a consistent marker, don't guess: report the Jira-sync count only and say per-task implementation status isn't determinable from \`tasks.md\` alone.

Map what you find to a next step:

| Signal state | Report as next step |
|---|---|
| No artifacts in the change dir at all | Nothing started yet — \`/kido:specify\` |
| \`functional-spec.md\` only, no \`jiraId\`/\`epicId\` in frontmatter | At the checkpoint — push to Jira? continue into design now? → \`/kido:specify\` |
| \`functional-spec.md\` + \`design.md\`, \`epicId\` set | Existing-Epic mode, single Story, no task breakdown → \`kido jira pull <key>\` then \`/kido:apply\` directly |
| \`functional-spec.md\` + \`design.md\`, no \`epicId\` | \`/kido:tasks\` |
| \`tasks.md\` exists, not all tasks show a completion marker (or that's unknown) | \`/kido:apply\` — report however many look done vs. total, if that's known |
| \`tasks.md\` exists, every task shows a completion marker | Coarse zone — see below |
| \`bug.md\` only | \`/kido:apply\` (bug lane: reproduce with a failing test, then fix) |
| Found only under \`kido/changes/archive/<name>/\` | Already archived — nothing to do |

### Coarse zone

Past full task completion (or the single small-feature/bug artifact being synced), there's no on-disk signal telling \`/kido:review\`, commit/push/PR, and \`/kido:archive\` apart — none of those steps write anything back into \`kido/changes/<name>/\`. Don't guess which one specifically comes next. Report the coarse state honestly (e.g. "Tasks all show as implemented.") and name the remaining steps in order — \`/kido:review\` if it hasn't run yet, then commit/push/PR, then \`/kido:archive\` when ready — without claiming to know exactly which one is next.

## Step 3 — Report and offer to continue

State the detected status in plain language, then ask whether to continue straight into the recommended next step — e.g. "\`functional-spec.md\` is done, no \`design.md\` yet — you're at the checkpoint, waiting on design. Continue into \`/kido:specify\` now?" If yes, follow that skill's flow directly in this same session (same pattern \`/kido:archive\` uses when it re-invokes \`/kido:document\`). If no, stop — the report itself is the useful output.

## Guardrails

- Never write or modify any file, frontmatter, or Jira state — this command only reads and reports.
- Don't invent a task-completion marker convention if you can't find one consistently applied in \`tasks.md\` — say status is unknown rather than presenting a guess as fact.
- Don't skip straight to the next step without stating the detected status first — the status itself is half the value of this command, especially after a multi-day gap.
- No git or live-Jira calls — this reads only what's already on disk in \`kido/changes/\`. If that turns out to be too coarse in the "past full task completion" zone, that's a future extension, not something to work around here with ad hoc shell-outs.
`;

export const continueStage: PipelineStage = {
  id: "continue",
  description:
    "Read-only status/resume-point check across the whole pipeline — lists in-flight changes if none is named, detects which artifacts/frontmatter/Jira-sync/task-completion signals exist for the chosen one, and reports what to do next (optionally continuing straight into it). Safe to run anytime; never writes any artifact or Jira state.",
  allowedTools: "Bash(kido:*), Read, Glob, AskUserQuestion",
  body,
};
```

- [ ] **Step 4: Register the stage in `src/pipeline/definition.ts`**

Modify `src/pipeline/definition.ts`. Add the import alongside the other five (after line 23, `import { archiveStage } from "../skills-content/archive.js";`):

```typescript
import { continueStage } from "../skills-content/continue.js";
```

Then add `continueStage` to the `stages` array (currently lines 25-32) — place it last, after `archiveStage`, since it's advisory tooling rather than a numbered step in the linear chain:

```typescript
export const stages: PipelineStage[] = [
  documentStage,
  specifyStage,
  tasksStage,
  applyStage,
  reviewStage,
  archiveStage,
  continueStage,
];
```

- [ ] **Step 5: Run the full test suite to verify it passes**

Run: `npm test`
Expected: PASS — all tests green, including the updated `kido init scaffolds...` test in `test/init.test.ts`. This also runs `npm run build` first (per the `test` script in `package.json`), which transpiles the new `src/skills-content/continue.ts` — confirm the build step itself doesn't error (a TypeScript syntax mistake in the template literal would surface here).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no output, exit code 0. Confirms `continueStage`'s shape matches `PipelineStage` exactly (no missing/extra fields).

- [ ] **Step 7: Manual smoke check**

Run in a scratch directory to confirm the generated files look right end-to-end (build must be up to date from Step 5):

```bash
mkdir -p /tmp/kido-continue-smoke && cd /tmp/kido-continue-smoke && node /c/Solutions/Kido/dist/cli.js init --no-legacy
```

Expected: `.claude/skills/mr-continue/SKILL.md` and `.claude/commands/kido/continue.md` both exist, each starting with YAML frontmatter (`name:`, `description:`, `allowed-tools:`) followed by the body text written in Step 3. Spot-check the `description:` line reads as a single unbroken line (no stray newlines from the template literal). Clean up afterward: `rm -rf /tmp/kido-continue-smoke`.

- [ ] **Step 8: Commit**

```bash
git add src/skills-content/continue.ts src/pipeline/definition.ts test/init.test.ts
git commit -m "$(cat <<'EOF'
Add /kido:continue — resume-point detection across the pipeline

Reports which artifacts/Jira-sync/task-completion signals exist for
an in-flight change and what to do next, so a BA or Dev picking work
back up days later doesn't have to reconstruct pipeline state from
memory.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Change selection (named vs. list-and-ask), stage detection (existing signals only, reusing other stages' fork logic), the coarse-zone caveat, report+offer-to-continue output, and the read-only/no-git/no-Jira guardrails from the design doc are all present in the `continue.ts` body drafted above. The design's "Out of scope" items (CLI subcommand, git/Jira signals, DESIGN.md/kido-kit.html updates) are correctly not attempted here.
- **Placeholder scan:** No TBD/TODO; the full body text is written out verbatim in Step 3, not summarized.
- **Type consistency:** `continueStage` matches the exact `PipelineStage` field names (`id`, `description`, `allowedTools`, `body`) used by every other stage in `src/pipeline/definition.ts` and rendered identically by `src/pipeline/renderers/claude-code.ts` — no new fields introduced, so the renderer needs no changes.
