# TeamFlow Platform — Specification (v0.5)

> Working name: **TeamFlow** (placeholder). v0.4: workflow skills adapted from obra/superpowers, no central state, configurable TDD and review, project skills. v0.5: **Kilo Code is the only target.**

## 1. Goal

Make every member of a team follow the same delivery workflow with an AI coding agent, without slowing down the simple cases:

**specify → planify → implement → review → finish**, with debug, TDD, documentation and verification available at any time.

Delivered as an **npm package** (`teamflow-bootstrap`) that installs skills into **Kilo Code**, plus a **marketplace** (minimal, §7) to share skills.

Non-goals (v1): billing, hosting customer code or secrets, replacing Jira/Confluence/Bitbucket, hosting an LLM.

## 2. Architecture

```
message ──► primary agent "teamflow-router" ──► skill "teamflow" (router) ──► target tf-* skill ──► suggests next skill
            + TeamFlow rule in AGENTS.md                      └─ table rendered from routing.yml
```

- **Router**: one skill, `teamflow`, whose decision table is rendered from `routing.yml` (package) plus `.teamflow/routes/*.yml` (project).
- **Entry point**: a Kilo `primary` agent that loads `teamflow` first, reinforced by a TeamFlow block in the project's `AGENTS.md` (loaded automatically by Kilo).
- **Skills** are independent: each can be invoked directly, reads the files it needs (spec, plan), asks if they are missing, and proposes the next skill at the end.
- **No central state**: artifacts are files (`docs/teamflow/specs`, `docs/teamflow/plans`); implementation keeps its own ledger under `.teamflow/sdd/`.

## 3. Skills (Lot 1)

| Skill | Role | Origin |
|---|---|---|
| `teamflow` | Router | TeamFlow |
| `tf-specify` | Dialogue → validated design → spec | superpowers brainstorming |
| `tf-planify` | Spec → plan of small tested tasks | superpowers writing-plans |
| `tf-implement` / `tf-implement-subagents` | Execute the plan inline / with a subagent and a reviewer per task | superpowers executing-plans / subagent-driven-development |
| `tf-tdd` | Red → green → refactor | superpowers test-driven-development |
| `tf-review`, `tf-review-feedback` | Request a review; handle review comments | superpowers requesting/receiving-code-review |
| `tf-verify` | Evidence before "done" | superpowers verification-before-completion |
| `tf-finish` | Merge, PR or keep | superpowers finishing-a-development-branch |
| `tf-worktree` | Isolated workspace | superpowers using-git-worktrees |
| `tf-debug` | Root cause first | superpowers systematic-debugging |
| `tf-parallel-agents` | Independent problems in parallel | superpowers dispatching-parallel-agents |
| `tf-writing-skills` | Write and test new skills | superpowers writing-skills |
| `tf-document` | Docs grounded in the code | TeamFlow |

Lot 2: `tf-architect-solution`, `tf-jira`, `tf-confluence`, `tf-bitbucket`, `tf-deploy`, test-campaign skill.

## 4. Router rules

- **R1.** `routing.yml` is the only source; the router skill and the Kilo agent's skill list are generated from it.
- **R2.** `sync` and `doctor` fail when a route targets a skill that is not installed, or when `review.skill` does not exist.
- **R3.** First match wins (ascending `order`); at most one clarifying question.
- **R4.** The routing step never writes files, runs git or calls external systems.
- **R5.** A message describing something broken goes to `tf-debug` before anything else.
- **R6.** `implement` resolves to `tf-implement-subagents` when `implement.mode: subagents`; `review` resolves to `review.skill`.
- **R7.** Compound requests go to the first needed skill; the next one is announced.
- **R8.** A sample-message suite (English and French) checks routing in Kilo (manual in Lot 1, automated later).

## 5. Configuration (`.teamflow/config.yml`)

- `implement.mode`: `inline` | `subagents`.
- `implement.tdd`: `required` | `recommended` | `off` — applied by tf-planify (test steps) and tf-implement* (gate).
- `review.perTask`, `review.final` (booleans), `review.skill` (replace tf-review), `review.checklist` (team checklist).
- `git.commitArtifacts`: `ask` | `auto` | `never`. Nothing is committed to the default branch without approval.
- `paths.*`, `adapters.kilo.agentDir`.

## 6. Package and extensibility

- `install` / `sync` (`--global`, `--force`), `doctor`, `new-skill <name>`.
- Re-runs never overwrite user-edited files without `--force`.
- New skills: `.teamflow/skills/<name>/SKILL.md` + `.teamflow/routes/<name>.yml` → `sync` installs them in Kilo and adds the route. Same name/id overrides the package version.
- Works on Windows, macOS, Linux (Node ≥ 18). Skills calling bash scripts need Git Bash or WSL on Windows.
- The skills keep Claude Code vocabulary from upstream; `kilo-tools.md` maps it to Kilo.

## 7. Marketplace (minimal v1)

- A **pack** is a folder of skills plus route files, installable with the CLI.
- Browse and search packs; pack page with README, versions, routes it adds, install command, checksum.
- Publish through the CLI with a token; uploads are validated (structure, file allow-list, size, secrets scan, route conflicts against the base table).
- Immutable versions; an admin can yank. SSO login. English first.

## 8. Milestones

| # | Content | Done when |
|---|---|---|
| M0 | Package skeleton: renamed skills, router, `routing.yml`, CLI, tests | `npm test` green (done in this repo) |
| M1 | Validation on real projects with Kilo; sample-message suite; fixes | Feature → spec → plan → implementation → review → finish works in Kilo |
| M2 | Pack format + `pack add/publish`; license decided; first npm release | A pack installs from a local folder or URL |
| M3 | Marketplace v1 | A third-party pack is published and installed via the CLI |

## 9. Open questions

1. Product and npm package names; license (MIT would match the upstream skills).
2. Kilo specifics to confirm: agent folder (`.kilo/agent` vs `.kilo/agents`), subagent tool, behaviour of a primary agent with restricted permissions.
3. Should the router agent in Kilo lose `edit`/`bash` permissions (stronger enforcement) if skills still work?
4. Marketplace hosting and SSO provider.
5. Default language of the skills (English only, or English + French).
