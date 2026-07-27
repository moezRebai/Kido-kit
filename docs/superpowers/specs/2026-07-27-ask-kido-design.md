# `/kido:ask` — stateless command reference and router

## Problem

Kido's pipeline now has 7 stages (`document`, `specify`, `planify`, `implement`, `review`, `archive`, `continue`),
each its own skill/command generated from `src/pipeline/definition.ts`. A user who doesn't have the pipeline
memorized has no single place to ask "what does `/kido:planify` actually do?" or "which command do I run for
situation X?" other than rereading `README.md`/`DESIGN.md` or guessing from the `/` picker's one-line descriptions.

This is the same gap mattpocock's `skills-main` repo (the public source Kido's `planify`/`review` stages already
credit as inspiration — see `DESIGN.md`) solves with `/ask-matt`, a router skill over that repo's ~20 skills. Kido
is much smaller (7 stages, a linear pipeline), so the need is narrower, but "what does X do" and "which command
fits my situation" are still real, recurring questions with no dedicated answer today.

This is deliberately **not** the same problem `/kido:continue` solves. `/kido:continue` is stateful — it inspects a
specific in-flight change's on-disk artifacts and Jira frontmatter to report what to do next *for that change*.
The gap here is stateless: "what does this command do in general," independent of any particular change.

## Design

A new pipeline stage, `ask`, added to `src/pipeline/definition.ts` alongside the existing seven, generated the
same way into `.claude/skills/mr-ask/SKILL.md` and `.claude/commands/kido/ask.md`. No new CLI subcommand, no new
state file, no reads of `kido/changes/` or Jira — purely a reference over the other seven stages.

### Wiring

Unlike every other stage (a plain `PipelineStage` constant exported from its own `skills-content/*.ts` file), `ask`
is generated *from* the other stages, to avoid hand-maintaining a second copy of what each command does (the exact
drift risk just seen when `tasks`/`apply` were renamed to `planify`/`implement` — every hand-written cross-reference
across six other files had to be updated by hand).

`src/skills-content/ask.ts` exports a builder, not a constant:

```ts
export function buildAskStage(otherStages: PipelineStage[]): PipelineStage
```

`src/pipeline/definition.ts` changes from a flat list to:

```ts
const otherStages: PipelineStage[] = [
  documentStage, specifyStage, planifyStage, implementStage, reviewStage, archiveStage, continueStage,
];

export const stages: PipelineStage[] = [...otherStages, buildAskStage(otherStages)];
```

`renderClaudeCodeStage` (`src/pipeline/renderers/claude-code.ts`) needs no changes — it already treats every
`PipelineStage` identically regardless of how `body` was produced.

### Stage metadata

```ts
{
  id: "ask",
  description:
    "Reference/router: answers \"what does /kido:X do\" and \"which command fits my situation\" from a live-generated table of every other command. Stateless — never reads kido/changes/ or Jira; redirects to /kido:continue for a specific in-flight change's status.",
  allowedTools: "Read",
  body, // see below
}
```

`allowedTools: "Read"` is the minimum needed for the "explain X in detail" path (below) — no `Bash`/`Write`/`Edit`,
consistent with never touching `kido/changes/` or running `kido status`.

### Body content

Generated from `otherStages`, not hand-written prose, so it can't drift out of sync as stages are added, renamed,
or re-described:

```
# Ask Kido

You don't need to remember every /kido: command — ask.

## Commands

| Command | What it does |
|---|---|
| /kido:document | <documentStage.description> |
| /kido:specify | <specifyStage.description> |
| /kido:planify | <planifyStage.description> |
| /kido:implement | <implementStage.description> |
| /kido:review | <reviewStage.description> |
| /kido:archive | <archiveStage.description> |
| /kido:continue | <continueStage.description> |

## Answering "what should I use for X?"

Match the user's situation against the table above — the descriptions already encode each command's fork points
and hand-offs to the next command. Ask a clarifying question if the situation is genuinely ambiguous (e.g. bug vs.
feature) rather than guessing.

## Answering "what does X do in detail?"

The table's one-liner is a summary, not the full story. Read `.claude/commands/kido/<id>.md` for the complete
orchestration body before answering an "explain X in detail" question.

## Guardrails

- Never inspect `kido/changes/` or Jira state — that's `/kido:continue`'s job for a specific in-flight change. If
  the question is really "what's next for MY change" rather than "what does this command do in general," redirect
  there instead of guessing from this table alone.
- Don't invent behavior beyond what the table or the full command file actually says.
```

No separate hand-written "decision map" section duplicating the table: the seven descriptions already carry real
routing signal (e.g. `planify`'s description ends with "Branch creation happens later, in /kido:implement";
`specify`'s covers the bug/feature fork), so the model reasons over the table plus the user's stated situation
live, the same way it already reasons inside any other skill — rather than us hand-maintaining a second decision
tree that has to track the first one.

## Guardrails

- Stateless: never reads `kido/changes/`, `.kido-meta.json`, frontmatter, or Jira. Any question that actually
  needs that (specific in-flight change status) gets redirected to `/kido:continue`, not answered here.
- The generated table is the single source of truth for "what does X do" at the summary level — if a stage's
  `description` changes, `ask`'s output changes automatically on the next `kido init`/render, no manual edit
  required.
- `Read` access is scoped to explaining commands in more depth on request, not for general-purpose file
  exploration.

## Test changes

- `test/init.test.ts` — the exact-set assertions for generated skill dirs (`mr-*`) and command files
  (`.claude/commands/kido/*.md`) need `"mr-ask"` / `"ask.md"` added.
- New test (e.g. `test/ask-stage.test.ts`) asserting the generated `ask` stage's body contains every other stage's
  `id` and `description` — this is what actually locks in the "can't drift" property the generation approach is
  for; without it, a future stage addition could silently be left out of the table with nothing failing.

## Docs

- `README.md`: add an `/kido:ask` line to the quick-start command list; fix the intro sentence, which already says
  "generates *six* Claude Code skills/commands" while there are 7 today (stale before this change) — becomes 8
  after `ask` is added.
- `DESIGN.md`: add an `/kido:ask` row to the command table. Not added to the mermaid pipeline diagram — like
  `/kido:continue`, it's advisory tooling alongside the linear pipeline, not a stage that reads/writes a change
  artifact or occupies a position in the flow.

## Out of scope

- Any per-change state (that's `/kido:continue`). If `/kido:ask` and `/kido:continue` ever prove confusing as two
  separate commands in practice, merging them is a future design, not part of this one.
- A hand-written situational decision tree beyond what the generated table + live model reasoning already covers.
  If specific routing questions turn out to need more explicit guidance than the descriptions provide, that's a
  future addition to individual stages' `description` fields, not a parallel narrative maintained inside `ask`.
