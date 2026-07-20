# Kido

Spec-driven BA/Dev collaboration for greenfield and brownfield microservices — an installable CLI plus a set of generated Claude Code skills/commands, with Jira as the handoff between BA and Dev (BA doesn't need git push access).

A full walkthrough of the pipeline, stage by stage with real example output, is in [`kido-kit.html`](./kido-kit.html) — open it directly in a browser.

## What it does

Two roles collaborate through a shared, versioned artifact chain instead of a Jira board alone:

- **BA** writes a functional spec, gets it grilled (challenging Q&A, not a form to fill in), and pushes it to Jira as an Epic.
- **Dev** picks up work by Jira key — no git access needed on BA's side — implements it with TDD via subagent-per-task dispatch, and every task gets reviewed against the spec before it's considered done.

The tool owns the specs (`kido/changes/<name>/*.md`); Jira is a generated, one-way-then-pull mirror, not the source of truth.

## Install

Not published to npm yet — install locally:

```bash
git clone https://github.com/moezRebai/Kido-kit.git
cd Kido-kit
npm install
npm run build
npm link
```

`kido` is now on your `PATH`. Requires Node.js 20+.

## Quick start

```bash
cd your-microservice-repo
kido init
```

This scaffolds `kido/docs/` + `kido/changes/`, generates six Claude Code skills/commands under `.claude/`, and offers to seed `kido/docs/` from a legacy repo or set up Jira credentials.

Then, inside Claude Code:

```
/kido:document   # brownfield only — builds kido/docs/ from the existing codebase
/kido:specify    # BA: functional-spec.md + design.md, in one session, pushed to a Jira Epic
/kido:tasks      # BA: breaks design.md into vertical-slice tasks, synced as Jira Stories
/kido:apply      # Dev: give it a Jira key — pulls the spec, creates the branch, implements task by task
/kido:review     # spec-traceability + standards, per task and on demand
/kido:archive    # commit, refresh docs, sync anything changed back to Jira, close the change
```

See [`kido-kit.html`](./kido-kit.html) for the full 8-stage walkthrough with actual console output and file contents at every step.

## CLI reference

| Command | What it does |
|---|---|
| `kido init` | Scaffold `kido/` + generate skills/commands. |
| `kido new-change <name> [--type feature\|bug]` | Start a new change folder. |
| `kido status --change <name>` / `kido validate --change <name>` | Check artifact completion / readiness to archive. |
| `kido archive <name>` | Move a change to `kido/changes/archive/`. |
| `kido docs export --to <path>` | Copy `kido/docs/` into another repo (cross-repo/rewrite seeding). |
| `kido jira sync --change <name> [--epic <KEY>]` | Push spec/task/bug content to Jira, idempotently. |
| `kido jira pull <key> [--as <name>]` | Materialize a Jira Epic/Story/Bug into a local change folder — how Dev picks up BA's work. |

## Design docs

- [`DESIGN.md`](./DESIGN.md) — what Kido is and how it works today.
- [`docs/DECISION_LOG.md`](./docs/DECISION_LOG.md) — the full chronological rationale behind every design decision.

## Testing

```bash
npm test
```

## License

MIT — see [`LICENSE`](./LICENSE).
