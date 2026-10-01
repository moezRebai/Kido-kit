# 03 — Coding-agent adapters

TeamFlow targets **Kilo Code** in the MVP and MUST be extensible to other coding agents (Claude Code,
Gemini CLI, …) without rewriting skills. This is achieved by authoring skills once in a **canonical
format** and installing them through an **adapter** per coding agent.

## 1. What differs between coding agents

| Concern | Kilo Code (MVP) | Claude Code (future) | Gemini CLI (future) |
|---|---|---|---|
| Project skills folder | `.kilocode/skills/<name>/SKILL.md` **(verify)** | `.claude/skills/<name>/SKILL.md` | `.gemini/skills/<name>/SKILL.md` |
| User skills folder | `~/.kilocode/skills/` **(verify)** | `~/.claude/skills/` | `~/.gemini/skills/` |
| Permanent rule | `instructions` in `kilo.jsonc`, or `.kilocode/rules/*.md` **(verify)** | `CLAUDE.md` / `SessionStart` hook | `GEMINI.md` |
| Per-message hook | Plugin in `.kilo/plugin/`, event `chat.message` **(verify)** | `UserPromptSubmit` hook | (verify) |
| Explicit-only invocation | (verify) — fallback: description says "use only when explicitly invoked" | `disable-model-invocation: true` frontmatter | (verify) |
| Sub-agents / isolated context | (verify: sub-tasks or custom agents) | Agent/Task tool | (verify) |
| Running scripts | Terminal tool; command approval settings **(verify)** | Bash tool + permissions | Shell tool |

TeamFlow installs skills, the routing rule and the plugin at **user (global) scope only** (decision
D-26). The `project` scope stays in the adapter interface for future agents but is not used by the MVP.

Everything marked **(verify)** is tracked in [14](14-decisions-and-open-questions.md) and resolved in
work package WP-02 ([13](13-mvp-plan.md)).

## 2. Canonical skill format

Every TeamFlow skill is authored like this in the source repository:

```
<skill-name>/
├── SKILL.md
├── references/      # optional — Markdown read on demand
└── scripts/         # optional — bundled .mjs files
```

`SKILL.md` frontmatter (canonical — the adapter translates it):

```yaml
---
name: tf-implement                       # MUST equal the folder name
description: >-                          # used by the coding agent for auto-invocation; ≤ 1024 chars
  Implements a TeamFlow topic: creates the branch, then implements each task with test-first
  development and a spec review per task. Use when the user gives a Jira key or asks to implement
  an approved TeamFlow spec.
teamflow:
  version: 1                             # canonical format version
  invocation: explicit                   # auto | explicit
  sideEffects: [git]                     # none | files | git | jira | bitbucket | confluence | external
  phase: implement                       # optional: the phase this skill drives
  needs: [topic]                         # context the router must pass: topic, branch, pr, jiraKey
---
```

Body rules:
- Written in English, imperative, organized in numbered steps.
- References are loaded with explicit instructions ("Read `references/tdd.md` before step 3").
- Scripts are invoked with paths relative to the skill folder, e.g.
  `node "<skill-dir>/scripts/state.mjs" set-phase --topic <id> --to implement`. The adapter replaces the
  `<skill-dir>` token with the installed absolute path when the agent requires it **(verify)**.
- No agent-specific tool names in the body (say "run the command", not "use the Bash tool").

## 3. Adapter interface

Implemented in `src/adapters/` of the TeamFlow source. This generalizes the renderer pattern that
already exists in this repository (`src/pipeline/renderers/types.ts`, `registry.ts`, `kilo-code.ts`):
one module per coding agent behind a common interface, selected by id from a registry.

```ts
export type AgentId = "kilo" | "claude-code" | "gemini-cli";
export type Scope = "user" | "project";

export interface AgentCapabilities {
  autoInvokeSkills: boolean;
  explicitOnlySkills: "native" | "description-fallback";
  perMessageHook: boolean;
  isolatedSubAgents: boolean;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  capabilities: AgentCapabilities;

  /** Absolute folder where skills are installed for this scope. */
  skillsDir(scope: Scope, repoRoot?: string): string;

  /** Copies a canonical skill folder and rewrites SKILL.md frontmatter/body for this agent. */
  installSkill(skillDir: string, scope: Scope, repoRoot?: string): InstalledSkill;

  /** Removes an installed skill (used by tf-packs remove/update). */
  uninstallSkill(name: string, scope: Scope, repoRoot?: string): void;

  /** Registers or updates the permanent TeamFlow routing rule. Idempotent. */
  installRule(ruleMarkdown: string, scope: Scope, repoRoot?: string): void;

  /** Installs the per-message routing hook/plugin if the agent supports it. Idempotent. */
  installRoutingHook?(hookBundlePath: string, scope: Scope, repoRoot?: string): void;

  /** Returns true if this agent appears to be installed/configured on the machine or repo. */
  detect(repoRoot?: string): boolean;
}

export interface InstalledSkill {
  name: string;
  path: string;
  files: string[];
}
```

### 3.1 Frontmatter translation (Kilo adapter)

| Canonical | Kilo output |
|---|---|
| `name`, `description` | copied |
| `teamflow.invocation: explicit` | native field if Kilo supports one **(verify)**; otherwise the description is prefixed with "Only use when the user explicitly invokes this skill by name." |
| `teamflow.*` (other keys) | kept under `teamflow:` (ignored by Kilo, read by the router through `tf-packs list --metadata`) |

### 3.2 Adapter selection

- `teamflow/config.yml` → `agent: kilo` (default `kilo` in the MVP).
- The bootstrap installer and `tf-packs` use the configured adapter. If several adapters are configured
  (future), `tf-packs` installs every skill once per adapter.

## 4. Adding a new coding agent (post-MVP procedure)

1. Fill the comparison table above for the new agent.
2. Implement `src/adapters/<agent>.ts` and register it.
3. Add golden-file tests: installing each `teamflow-core` skill produces the expected files.
4. Implement `installRule` and, if supported, `installRoutingHook` (a port of the Kilo plugin logic).
5. Run the routing evaluation scenarios ([13](13-mvp-plan.md)) with the new agent; reach the same ≥ 90 %
   bar before declaring support.

No skill, reference, script or pack manifest changes are required to add an agent; if one is needed,
the canonical format is missing a concept and MUST be extended first.
