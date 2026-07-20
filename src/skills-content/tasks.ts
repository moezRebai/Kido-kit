import type { PipelineStage } from "../pipeline/definition.js";

const body = `Break a feature's \`design.md\` into implementable tasks. BA-run — this happens before any Dev involvement, producing Jira Stories that Dev later picks up by key (see \`/kido:apply\`). **Feature path only** — bug fixes don't use this (see \`/kido:specify\`'s bug path and \`/kido:apply\`'s guardrails).

**Store selection:** resolve the repo root. Run \`kido status --change <name>\` to confirm \`functional-spec.md\` and \`design.md\` are both present before starting — if either is missing, redirect to \`/kido:specify\`.

## Reads

Both \`functional-spec.md\` AND \`design.md\` (not design.md alone), plus \`kido/docs/\` for architecture/conventions context.

## Task breakdown philosophy: vertical slices, not layers

Adapt the \`to-tickets\` approach: break the work into **vertical-slice, tracer-bullet tasks** — each one cuts through every layer it touches (schema, API, UI, tests together) and is independently completable and demonstrable on its own. Avoid horizontal layering (e.g. "task 1: all the schema changes, task 2: all the API changes") — that produces tasks that can't be verified or shipped independently, and defeats the point of subagent-per-task dispatch in \`/kido:apply\`.

For each task, capture:
- Description (what it does, framed as a demonstrable slice)
- Likely-touched files/areas
- Acceptance check — ideally a specific test that should pass once it's done (TDD convention)
- Dependencies on other tasks (for \`/kido:apply\`'s sequential-vs-parallel dispatch)

## Validate coverage

Every decision/component named in \`design.md\` should map to at least one task. If something in the design has no corresponding task, that's a gap — surface it before finishing, don't silently drop it.

## Present for feedback

Show the numbered breakdown (title, blockers, deliverable) before finalizing — ask whether granularity/dependencies look right, or if any tasks should merge/split.

## Format (required — the CLI parses this to sync each task as a Jira Story)

Write each task as its own \`##\` heading, in this exact shape, so \`kido jira sync\` can extract them reliably:

\`\`\`
## Task 1: <short title>

<description of the vertical slice>

**Depends on:** none | Task <n>[, Task <m>...]
**Test:** <the acceptance check / test that should pass>
\`\`\`

## Write and sync

Write \`tasks.md\` to \`kido/changes/<name>/\`.

**Ask**: "Want me to push these to Jira?" If yes, figure out the Epic to attach Stories to before running the sync:
- If \`functional-spec.md\` exists in this change, it auto-syncs as its own Epic and that's used automatically — nothing more to ask.
- If there's no \`functional-spec.md\` (a Dev-only, non-business-facing change), OR the user mentions an Epic that already exists in Jira from before, **ask**: "Is there an existing Jira Epic these Stories should nest under?" If they give you a key, run \`kido jira sync --change <name> --epic <KEY>\` — the explicit \`--epic\` always wins over whatever \`functional-spec.md\` would have produced. If they say there's no relevant Epic, run \`kido jira sync --change <name>\` plain — Stories sync with no parent.

Either way: each task becomes a Jira **Story** directly (no Sub-task level; Epic → Story, two levels, not three). The **project** Stories/Epics land in is never something to ask about — it's fixed per repo via the configured Jira credentials (one project per microservice), not a per-change choice.

That's the end of this command's job. Branch creation doesn't happen here — BA doesn't have push access, so it wouldn't be BA's branch to create. Dev creates it when they pick up a Story (see \`/kido:apply\`'s Jira-key entry point).

## Guardrails

- Never silently sync to Jira — always ask first.
- Don't produce tasks that can only be verified once every other task is also done — that's a sign they're layered, not sliced.
`;

export const tasksStage: PipelineStage = {
  id: "tasks",
  description:
    "BA-run: break a feature's functional-spec.md + design.md into vertical-slice, independently-demonstrable tasks and sync them as Jira Stories. Feature path only. Branch creation happens later, in /kido:apply.",
  allowedTools: "Bash(kido:*), Read, Write, AskUserQuestion",
  body,
};
