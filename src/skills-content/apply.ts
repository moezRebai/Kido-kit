import type { PipelineStage } from "../pipeline/definition.js";

const body = `Implement a change. Behavior differs by type — check \`kido/changes/<name>/\` for which files exist before doing anything.

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

- Don't skip the branch-creation step (handled by \`/kido:tasks\`/\`/kido:spec\`'s bug path before this runs) — confirm you're on the right branch before starting.
- Don't let a subagent read or modify files outside its own task's stated scope unless the task genuinely requires it.
- Don't mark a task complete without its test passing.
- **Never present "commit / push / sync to Jira / next steps" to the user until review has actually been performed for every task** (or the bug fix). If you find yourself about to suggest committing without having done the review step, stop — go back and do the review first.
`;

export const applyStage: PipelineStage = {
  id: "apply",
  description:
    "Implement a change's tasks (one subagent per task, TDD, dependency-ordered) or a bug fix (reproduce with a failing test, then fix). Reads functional-spec.md/design.md/tasks.md or bug.md plus kido/docs/.",
  allowedTools: "Bash(kido:*), Read, Write, Edit, Bash, Agent",
  body,
};
