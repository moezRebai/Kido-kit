import type { PipelineStage } from "../pipeline/definition.js";

const body = `Implement a change. This is Dev's entry point into the pipeline — BA doesn't have push access, so everything from here on (branch, commits, PR) is Dev's to do.

## Entry: local change name or Jira key

Dev may give you either a local change name (if it's already in \`kido/changes/<name>/\` — e.g. picking back up on something) or a **Jira key** (Epic, Story, or Bug — e.g. "apply PROJ-456") — this is the normal case, since BA's work reached Jira, not the local filesystem.

If given a Jira key and \`kido/changes/<name>/\` doesn't already exist locally: run \`kido jira pull <key>\` first. It resolves the full change from Jira (a Story pulls its parent Epic too) and materializes \`functional-spec.md\`/\`design.md\`/\`tasks.md\` (or \`bug.md\`) locally, printing the resolved change name — use that name for everything below. If the local folder already exists, don't silently overwrite it — ask before re-pulling over local edits.

## Branch creation

Before doing anything else, always confirm the branch name — never create one silently. The default you propose depends on whether a Jira ID is known for this change:
- **Jira ID known** (from the pull above, or already in frontmatter): propose \`feature/<JIRA-ID>-<slug>\`.
- **No Jira** (working from a purely local change with no Jira sync): propose \`feature/<change-name>\` (the kebab-case change folder name, e.g. \`feature/spread-calculation\`) as the fallback.

Either way, **ask**: "Ready to create branch \`<proposed-name>\`? Or give me a different name if you'd prefer." Always let the user override with a name of their own choosing rather than treating the default as final.

## Feature path (tasks.md exists)

One subagent per task in \`tasks.md\`, by default — not one long session doing everything. Each subagent gets the full context bundle: \`functional-spec.md\` + \`design.md\` + this specific task + \`kido/docs/\`. Scoped tight, not the whole change.

- **Ordering**: tasks with declared dependencies run sequentially, in dependency order. Independent tasks may run in parallel.
- **TDD**: each subagent writes the failing test for its task first, then implements to make it pass — same convention the rest of the pipeline assumes.
- **Progress**: check off each task in \`tasks.md\` as its subagent completes it (mirrors how \`kido status\` reports completion).
- **After each task's subagent finishes, YOU must explicitly perform the \`/kido:review\` check yourself before moving to the next task or suggesting anything else** (spec-traceability + standards, per that skill's process) — this does NOT happen on its own just because it's described elsewhere. Treat it as the next required step in this same sequence, not something a separate mechanism triggers for you.

## Bug path (bug.md exists, no tasks.md)

No subagent dispatch — a bug fix is one unit of work by default:
1. **Reproduce first**: write a unit test that captures the bug as described in \`bug.md\`. Confirm it fails.
2. **Fix**: implement the change. Confirm the test now passes.
3. **Perform the \`/kido:review\` check yourself** against \`bug.md\`'s description before suggesting anything else.

(If a "bug" turns out to actually need multi-task breakdown once you're in it, that's the exception — escalate to \`/kido:tasks\` rather than forcing it through this single-pass flow.)

## Guardrails

- Don't skip the branch-creation step above — confirm you're on the right branch before starting any task.
- Don't let a subagent read or modify files outside its own task's stated scope unless the task genuinely requires it.
- Don't mark a task complete without its test passing.
- **Never present "commit / push / sync to Jira / next steps" to the user until review has actually been performed for every task** (or the bug fix). If you find yourself about to suggest committing without having done the review step, stop — go back and do the review first.
`;

export const applyStage: PipelineStage = {
  id: "apply",
  description:
    "Dev's entry point — accepts a local change name or a Jira key (running kido jira pull to materialize it if needed), creates the branch, then implements a change's tasks (one subagent per task, TDD, dependency-ordered) or a bug fix (reproduce with a failing test, then fix).",
  allowedTools: "Bash(kido:*), Read, Write, Edit, Bash, Agent",
  body,
};
