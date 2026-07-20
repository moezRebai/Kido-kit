import type { PipelineStage } from "../pipeline/definition.js";

const body = `Review a diff — either automatically (per-task during \`/kido:apply\`) or on demand (manually invoked anytime against the current branch/changes, whether or not a Kido pipeline is even in flight).

## Composable pipeline: two stages, always both

1. **Spec-traceability**: does the diff actually match what was promised? Compare against \`design.md\`/\`tasks.md\` (feature path) or \`bug.md\`'s description (bug path). Flag silent scope drift — code that's reasonable but different from what was specified — not just outright bugs.
2. **Standards**: read the conventions section of \`kido/docs/{project}-technical-docs.md\` (Clean Architecture, TDD, SOLID, DRY, or whatever this project actually documents there — it's the declarative source of truth, don't hardcode a fixed checklist). Then **invoke the team's own existing code-review skill** (e.g. Claude Code's \`code-review\`) to actually perform the check — don't reimplement review logic here, reuse what already exists.

If there's no associated change (pure on-demand review with nothing to trace against), skip stage 1 and just run stage 2.

## When it runs

- **Automatically**: after each task's subagent finishes in \`/kido:apply\`, before the next dependent task starts.
- **On demand**: anytime, standalone — a Dev can just ask for a review of the current branch or working changes without any change being in progress.

## Guardrails

- Don't skip stage 1 just because stage 2 passes — a clean, well-written implementation of the wrong thing is still a defect.
- Don't fabricate a coding-guidelines checklist if \`technical-docs.md\` doesn't document one yet — flag that as a gap for \`/kido:document\` to fill in, rather than inventing standards the team never agreed to.
`;

export const reviewStage: PipelineStage = {
  id: "review",
  description:
    "Review a diff for spec-traceability (does it match design.md/tasks.md/bug.md) and standards (per kido/docs/ conventions, via the team's existing code-review skill). Runs per-task automatically, or on demand anytime.",
  allowedTools: "Bash(kido:*), Read, Bash, Grep",
  body,
};
