# 05 — Skills catalog

All skills follow the canonical format in [03](03-agent-adapters.md). Agents (`tf-agent-*`) are
specified in [08](08-agents-and-checks.md). Script commands are specified in [06](06-artifacts-and-state.md)
(state), [09](09-atlassian-integrations.md) (integrations) and [10](10-marketplace-and-packs.md) (packs).

## Summary

| Skill | Pack | Invocation | Side effects | Drives phase |
|---|---|---|---|---|
| `teamflow` | teamflow-core | auto | none | — |
| `tf-specify` | teamflow-core | auto | files | groom, spec |
| `tf-forge` | teamflow-core | auto | via other skills | all (solo) |
| `tf-planify` | teamflow-core | explicit | files; Jira via `tf-jira` | plan |
| `tf-implement` | teamflow-core | explicit | files, git | implement |
| `tf-review` | teamflow-core | auto | none (report only) | — |
| `tf-archive` | teamflow-core | explicit | files, git; Bitbucket/Jira/Confluence via their skills | ship, archived |
| `tf-document` | teamflow-core | auto | `teamflow/docs/` | — |
| `tf-architecture` | teamflow-core | auto | `teamflow/docs/`, topic files | architecture |
| `tf-explain` | teamflow-core | auto | none | — |
| `tf-packs` | teamflow-core | explicit (list/search: auto) | skills folders, `packs.lock` | — |
| `tf-jira` | teamflow-jira | explicit | Jira | — |
| `tf-bitbucket` | teamflow-bitbucket | explicit | git, Bitbucket | — |
| `tf-confluence` | teamflow-confluence | explicit | Confluence | — |

"Explicit" skills MUST NOT be auto-invoked by the coding agent; they run when the user names them or
when another TeamFlow skill invokes them after a gate.

Every skill that changes a topic MUST call the state script (`scripts/state.mjs`, copied into the skill
at build time) rather than editing `state.md` by hand.

---

## `teamflow` — Router

- **Description (trigger text):** "TeamFlow entry point. Use first for any work on this repository: new
  feature, bug, documentation, legacy rebuild, questions about how the code works, quality or security
  analysis, or installing TeamFlow capabilities. Routes to the right TeamFlow skill or asks one question."
- **Inputs:** user message; plugin context note; installed skill metadata (`tf-packs list --metadata --json`);
  `teamflow/config.yml`; `state.mjs list --active --json`; `~/.teamflow/profile.json`.
- **Behavior:** apply the decision table in [02 §3.1](02-architecture.md); never do the work itself
  except trivial answers; pass resolved context to the target skill.
- **References:** `routing-table.md`, `roles.md`.
- **Scripts:** `state.mjs`, `packs-meta.mjs` (read-only metadata listing).
- **Acceptance:**
  - Picks the expected target on ≥ 90 % of `evals/routing/*.yml` scenarios.
  - Asks at most one question before routing.
  - When a required pack is missing, names it and offers installation.

## `tf-specify` — Grooming and spec

- **Description:** "Turns a feature, bug or change request into a validated written spec through a
  one-question-at-a-time interview. Use for any new feature, change request or bug before writing code."
- **Inputs:** request, role, `teamflow/docs/`, resolved templates, active checklists, spec type.
- **Outputs:** `state.md` (init), `functional-spec.md` + `design.md` (feature), `bug.md` (bug),
  `rebuild.md` (rebuild), or the custom spec type's files.
- **State:** `init` → `groom` → `spec` → gate `spec-approved` → `set-mode`.
- **Behavior:**
  1. Resolve spec type (built-in or custom from config) and templates/checklists via the layer order.
  2. Grooming per `grilling.md`: one question per message; for design choices offer 2–3 options with
     trade-offs and a recommendation; cover boundary, failure and concurrency cases; cover every active
     checklist item.
  3. Write each section from the template following its `<!-- teamflow: … -->` guidance; present one
     section at a time for approval; remove guidance comments from the final file.
  4. Run `validate-spec` (script) against `spec.requiredSections` and the spec type rules; fix gaps.
  5. Offer `tf-architecture` when the change is structural.
  6. Record gate, ask the mode question unless `defaultMode` is set.
- **References:** `grilling.md`, `templates/*`, `checklists/*`, `spec-types.md`.
- **Scripts:** `state.mjs`, `resolve.mjs` (layer resolution), `validate-spec.mjs`.
- **Acceptance:** spec files pass `validate-spec`; every checklist item is either answered in the spec
  or recorded as an explicit open question; the gate is recorded with timestamp and user.

## `tf-forge` — Solo journey

- **Description:** "Solo end-to-end workflow: one person goes from a need to a pull request in one
  session, without Jira. Use when the user wants to do the whole thing alone."
- **Behavior:** orchestrates `tf-specify` (mode preset `solo`) → `tf-planify --local` → `tf-implement`
  → `tf-archive`; resumes from `state.md` phase if the topic exists; never skips a gate.
- **Acceptance:** an interrupted session resumes at the correct phase and task in a new session.

## `tf-planify` — Plan

- **Description:** "Splits an approved spec into vertical-slice tasks with dependencies, locally or as
  Jira Stories. Use only when explicitly invoked or by another TeamFlow skill after spec approval."
- **Inputs:** approved spec files; mode; `teamflow/docs/`.
- **Outputs:** `tasks.md` (format in [06](06-artifacts-and-state.md)); team mode: Jira Stories via `tf-jira sync`.
- **State:** `set-phase plan`, tasks registered (`state.mjs task add`), gate `plan-approved`.
- **Rules:** each task is independently demonstrable (schema + API + UI + tests together where relevant),
  ordered by dependency, small enough for one sub-agent; optional `Component`, `Criticality`, `Sprint`
  lines are asked for, never forced.
- **Rebuild:** produces lots; each lot creates a child feature topic (`state.mjs init --parent <id>`).
- **Acceptance:** `tasks.md` parses with the tasks parser; every functional rule of the spec maps to at
  least one task (traceability table at the end of `tasks.md`).

## `tf-implement` — Implementation

- **Description:** "Implements a TeamFlow topic: creates the branch, then implements each task test-first
  with a spec review per task. Use when the user gives a Jira key or asks to implement an approved
  TeamFlow spec."
- **Inputs:** topic id or Jira key; approved spec; `tasks.md` if any.
- **Behavior:**
  1. Jira key and no local topic → `tf-jira pull <KEY>`; if the folder exists, ask before overwriting.
  2. Refuse to start unless gate `spec-approved` (and `plan-approved` when `tasks.md` exists) is recorded.
  3. Propose branch from `naming.branch` / `naming.bugBranch`; 🛑 confirm; create via `tf-bitbucket branch`.
  4. Per task in dependency order (independent tasks MAY run in parallel isolated sub-agents if the
     coding agent supports it): context = spec + design + the task + `teamflow/docs/`; write failing
     test → run → show failure → implement → run → show pass (`state.mjs task <n> --tdd-red <cmd>` and
     `--tdd-green <cmd>` record the commands and exit codes) → invoke `tf-review` → mark done.
  5. Bug: reproduce-first test, fix, review.
  6. Never present commit/push before every task is reviewed.
- **References:** `tdd.md`, `review-protocol.md`.
- **Scripts:** `state.mjs`.
- **Acceptance:** for every done task `state.md` contains a red run (non-zero exit) recorded before a
  green run (zero exit) and `reviewed: true`.

## `tf-review` — Review

- **Description:** "Reviews changes against the TeamFlow spec (traceability, scope drift) and then
  against team standards. Use after each implemented task or when the user asks for a review."
- **Behavior:** (1) spec traceability: every change maps to a task/rule, nothing out of scope, nothing
  missing; (2) standards: invoke the skill named in `review.skill` (e.g. the team's own review skill) or
  the default checklist in `review-protocol.md` when none is configured; (3) output findings as
  blocker / should-fix / nit.
- **Acceptance:** a blocker prevents the task from being marked done.

## `tf-archive` — Ship and archive

- **Description:** "Ships a finished TeamFlow topic: verifies reviews and required checks, refreshes
  docs, archives the topic, commits, pushes and opens the pull request. Use only when explicitly invoked."
- **Behavior:** J8 in [04](04-user-journeys.md).
- **Scripts:** `state.mjs`, `ship-check.mjs` (verifies tasks, gates, required check reports for HEAD).
- **Acceptance:** cannot archive with an unreviewed task; cannot ship with a failing enforced agent; one
  push contains code, docs refresh and the archived topic.

## `tf-document` — Documentation

- **Description:** "Builds or refreshes the project documentation in teamflow/docs from the actual code,
  with every claim grounded in a file. Use to document a project, a module, or the existing application
  before a rebuild."
- **Modes:** `full` (default), `scope <topic|path>` (incremental), `rebuild` (adds `rebuild-checklist.md`),
  `import --from <path>` (copies another repository's `teamflow/docs/`).
- **Outputs:** `teamflow/docs/<project>-functional.md`, `<project>-technical.md`, `adr/*`.
- **Acceptance:** each section cites at least one source path; unknowns are listed under
  "Open questions"; re-running `full` on unchanged code produces no semantic change.

## `tf-architecture` — Architecture design

- **Description:** "Architect-led design session for structural changes or rebuilds: options with
  trade-offs, ADRs, C4 views, deployment, observability and migration. Use when a change is structural or
  a rebuild is planned."
- **Outputs:** ADRs in `teamflow/docs/adr/`, C4 views (Mermaid) in `<project>-technical.md`; for a topic,
  `design.md` sections or `rebuild.md` target/migration sections.
- **State:** `set-phase architecture`, gate `architecture-approved`.
- **Acceptance:** at least two options compared for each significant decision; each accepted decision
  has an ADR.

## `tf-explain` — Explain code

- **Description:** "Answers questions about how existing code works, read-only, with file references. Use
  when the user asks how something in this repository works."
- **Behavior:** read-only; cite paths and symbols; offer J1/J2/J3 when relevant.
- **Acceptance:** creates or modifies no file.

## `tf-packs` — Capabilities

- **Description:** "Lists, searches, installs, updates and synchronizes TeamFlow packs from the company
  marketplace. Use when the user asks what TeamFlow can do, or to install or update a capability."
- **Commands:** `list`, `search <text>`, `info <pack>`, `install <pack>[@range]`,
  `update [<pack>]`, `remove <pack>`, `sync` (install exactly what `packs.lock` says), `doctor`
  (checks policy compliance, missing credentials, adapter files).
- **Acceptance:** see [10](10-marketplace-and-packs.md) §6.

## `tf-jira`, `tf-bitbucket`, `tf-confluence`

Specified in [09](09-atlassian-integrations.md). Each is a thin `SKILL.md` explaining when to call its
script and what to confirm with the user, plus one bundled script.
