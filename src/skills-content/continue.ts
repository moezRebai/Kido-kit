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
