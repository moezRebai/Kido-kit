# `/kido:continue` — resume-point detection for the pipeline

## Problem

Kido's pipeline (`kido init` → `/kido:document` → `/kido:specify` → `/kido:tasks` → `kido jira pull` + branch →
`/kido:apply` → `/kido:review` → `/kido:archive`) spans two roles (BA, Dev) and typically multiple sessions days
apart. Nothing in the pipeline currently answers "where did we leave off, and what's next?" across the whole thing:

- `kido status --change <name>` reports artifact presence only (functional-spec.md/design.md/tasks.md or bug.md),
  requires an exact `--change` name up front, and doesn't interpret what that presence *means* for next steps.
- `/kido:specify` (`src/skills-content/specify.ts:31-35`) already re-runs `kido status` and branches on it, but
  only across its own two artifacts (functional-spec.md → design.md) — it has no awareness of `tasks.md`,
  `/kido:apply` progress, or `/kido:archive`.
- There is no command that lists in-flight changes at all; a user has to already know (or guess) the change name.

A BA who finishes a functional-spec, stops for two days, and comes back has no single command to ask "what do I do
next?" — they either remember the pipeline by heart or reread `DESIGN.md`.

## Design

A new pipeline stage, `continue`, added alongside the existing six in `src/pipeline/definition.ts`
(`src/skills-content/continue.ts`), generated the same way into `.claude/skills/mr-continue/SKILL.md` and
`.claude/commands/kido/continue.md`. No new CLI subcommand and no new state file — it's a read-only skill that
reasons over signals the pipeline already writes: artifact presence, `.kido-meta.json`, frontmatter (`jiraId`,
`epicId`), and `tasks.md`'s per-task `**Jira:**` markers and `- [x]` checkboxes.

### Change selection

- **If the user names a change** (as a command argument or in their message, e.g. "continue swap-pricing") — look
  it up directly: check `kido/changes/<name>/` first, then `kido/changes/archive/<name>/`. Skip the list-and-ask
  step entirely; go straight to stage detection (or the "already archived" report) for that name.
- **Otherwise**, `Glob` for `kido/changes/*/` (excluding `kido/changes/archive/`).
- **Zero changes** → say so, point at `/kido:specify` to start one.
- **One change** → use it, but name it out loud (e.g. "Found one in-flight change: `swap-pricing`.") — never
  silently assume.
- **Multiple changes** → print one line per change (name + a coarse stage label — see below) and ask which one via
  `AskUserQuestion` before giving detailed guidance.

### Stage detection

Reuses the same fork logic `/kido:specify` / `/kido:tasks` / `/kido:apply` already encode (bug path,
existing-Epic/single-Story path, full new-Epic feature path) — this command doesn't invent new branching rules,
it just reads the same signals those stages already produce and reports on them:

1. Run `kido status --change <name>` for artifact presence.
2. Read `.kido-meta.json` for `type` (`feature`/`bug`).
3. Read frontmatter on `functional-spec.md`/`bug.md`: `jiraId` (pushed to Jira?), `epicId` (existing-Epic mode —
   files as a single Story, skips `/kido:tasks` entirely).
4. If `tasks.md` exists: count tasks with a `**Jira:**` marker (synced) vs. without, and `- [x]` vs. `- [ ]`
   (implemented), for an "N/M implemented, M synced" readout.
5. Map to a next-step recommendation:

   | Signal state | Next step |
   |---|---|
   | No artifacts yet | `/kido:specify` |
   | `functional-spec.md` only, no `jiraId`/`epicId` | at the checkpoint — push to Jira? continue to design? → `/kido:specify` |
   | `functional-spec.md` + `design.md`, `epicId` set | existing-Epic mode, no task breakdown → `kido jira pull` + `/kido:apply` directly |
   | `functional-spec.md` + `design.md`, no `epicId` | `/kido:tasks` |
   | `tasks.md` exists, not all checked off | `/kido:apply` (report N/M done) |
   | `tasks.md` fully checked off | coarse zone (see below) |
   | `bug.md` only | `/kido:apply` (bug lane) |
   | change dir doesn't exist in `kido/changes/` but does in `kido/changes/archive/` | already archived — nothing to do |

### Coarse zone (known limitation, accepted tradeoff)

Once `tasks.md` is fully checked off (or the single small-feature/bug artifact is synced), there is no on-disk
signal distinguishing "implementing" from "implemented, review pending" from "reviewed, PR open" from "ready to
archive" — `/kido:review` and the commit/push/PR/archive steps don't write anything back to `kido/changes/<name>/`.
Detecting this precisely would require shelling out to `git` (branch/PR state) or Jira (issue status), which this
design deliberately excludes to keep the command fast, offline-safe, and free of new failure modes. In this zone,
`/kido:continue` reports the coarse state plainly (e.g. "All tasks implemented.") and names the remaining steps in
order — `/kido:review` if not done, then commit/push/PR, then `/kido:archive` — without claiming to know exactly
which one is next. This is an accepted gap, not silently glossed over.

### Output behavior

Narrate the detected state in plain language, then ask whether to launch the recommended next command, e.g.:

> "`functional-spec.md` is done, no `design.md` yet — you're at the checkpoint, waiting on design. Run
> `/kido:specify` now to continue into design?"

On yes, invoke that skill in the same turn. On no, stop — the report itself is the useful artifact.

## Guardrails

- Read-only: never writes or modifies any artifact, frontmatter, or Jira state itself. Safe to run at any point in
  any change's lifecycle, including from the "multiple changes" list step.
- No git shell-outs, no Jira API calls — mirrors the "existing signals only" scope decision above. If this proves
  too coarse in practice, extending into git/Jira signals is a separate future design, not silently folded in here.
- Reuses `/kido:specify`'s/`/kido:tasks`'s/`/kido:apply`'s existing fork logic (bug / existing-Epic / full-feature)
  rather than re-deriving it — if those stages' branching changes, this command's table above needs a matching
  update.

## Test changes

This stage is prompt-only (like the other five `skills-content/*.ts` stages), so there's no unit-testable logic
beyond the pipeline wiring itself:

- `test/` coverage for `src/pipeline/definition.ts` (if any exists asserting the stage list/count) needs updating
  to include `continue`.
- Manual verification via `kido init` in a scratch repo, confirming `.claude/skills/mr-continue/SKILL.md` and
  `.claude/commands/kido/continue.md` are generated with the expected frontmatter and body.

## Out of scope

- A CLI subcommand (`kido continue`) — considered and rejected in favor of a pure skill, to keep this in the same
  reasoning layer as the rest of the pipeline rather than adding new deterministic plumbing (see conversation
  history).
- Git branch/PR state and live Jira issue status as detection signals — would sharpen the coarse zone above, but
  adds network/shell dependencies this design deliberately avoids. Worth a future spec if the coarse zone proves
  insufficient in practice.
- Updating `DESIGN.md`'s stage table and `kido-kit.html`'s runbook/flow-diagram pages to include this as a named
  stage — `/kido:continue` is advisory tooling that sits alongside the pipeline rather than a numbered stage in it
  (it doesn't produce an artifact), so it doesn't need an `s8`. Worth a documentation pass afterward, not part of
  this design.
