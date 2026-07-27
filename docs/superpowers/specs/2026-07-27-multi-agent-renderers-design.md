# Multi-agent renderers — Gemini CLI and Kilo Code support

## Problem

Kido's generated skills/commands target Claude Code only. `DESIGN.md` already anticipated this being temporary:
the pipeline stages (`src/pipeline/definition.ts`) are pure agent-agnostic data — `{id, description,
allowedTools, body}` — deliberately kept behind a renderer interface (`src/pipeline/renderers/`) specifically so
"Gemini CLI/Kilo Code support can be added later as new renderers without touching the core." `DESIGN.md`'s
"Scope explicitly excluded from v1" section lists exactly this as the deferred item.

That day has come: Kido needs to generate usable artifacts for Gemini CLI and Kilo Code users too, not just
Claude Code.

## Research findings that shape this design

- **Gemini CLI has a real equivalent to Claude Code's auto-invoked skills.** It ships a native "Agent Skills"
  system (`.gemini/skills/<name>/SKILL.md`, discovered at session start, auto-activated via an `activate_skill`
  tool call when the model matches a task to a skill's description) explicitly built on **the same "Agent Skills"
  open standard** Claude Code uses — including the same `allowed-tools` frontmatter field. Gemini CLI also has
  explicit TOML-based custom commands (`.gemini/commands/<name>.toml`, namespaced via subdirectories with a `:`
  separator, e.g. `commands/kido/document.toml` → `/kido:document`). So Gemini CLI can get **full parity** with
  Claude Code: both the auto-invoke skill and the explicit command, per stage.
- **Kilo Code has no equivalent auto-invoke mechanism for a narrow, single-purpose script.** Its closest analog
  is custom modes (`whenToUse` + Orchestrator-mode delegation), but a "mode" there is a full agent persona
  (system prompt + its own tool-permission group) the user switches into — not a background auto-match over a
  library of narrow one-shot scripts. Mapping each Kido stage to its own custom mode would be a structural
  mismatch and was explicitly rejected (see decision below). Kilo Code gets **commands only**.
- **Kilo Code's VS Code extension and standalone CLI have unified on one command format**, current as of the
  docs fetched during this design: project-level slash-command prompt templates as markdown files in
  `.kilo/commands/<name>.md` (global: `~/.config/kilo/commands/`), invoked as `/<name>`. The older
  `.kilocode/workflows/*.md` path is legacy and auto-migrated by the tool on startup. One renderer covers both
  the VS Code extension and the CLI.
- Neither Gemini CLI's TOML commands nor Kilo Code's command markdown have a documented per-command tool
  allowlist field (unlike `allowed-tools` in the shared Agent Skills standard). `allowedTools` is carried over
  only where the target format actually supports it (both skill flavors), and dropped for the two new command
  artifacts.

**Risk flagged, not blocking:** Kilo Code's format was confirmed via docs fetched today; there's no SDK/schema to
catch future drift given Kido's zero-runtime-dependency policy. Worth a smoke check against an actually-installed
Kilo Code version before shipping, the same manual-walkthrough verification `DESIGN.md` already uses for Claude
Code.

## Design

### Renderer registry

`PipelineStage` (`src/pipeline/definition.ts`) is unchanged — it was already designed for this.

New `src/pipeline/renderers/types.ts`:

```ts
export type AgentId = "claude" | "gemini" | "kilo";

export interface AgentRenderer {
  id: AgentId;
  label: string; // "Claude Code" | "Gemini CLI" | "Kilo Code"
  /** Renders every stage for this agent into repoRoot; returns generated paths for the init summary. */
  render(stages: PipelineStage[], repoRoot: string): string[];
}
```

`src/pipeline/renderers/claude-code.ts` gains a thin `render()` wrapper around its existing
`renderAllClaudeCodeStages` (unchanged internals) so it satisfies `AgentRenderer`. Two new files follow the same
shape:

- `src/pipeline/renderers/gemini-cli.ts`
- `src/pipeline/renderers/kilo-code.ts`

New `src/pipeline/renderers/registry.ts`:

```ts
export const AGENT_RENDERERS: AgentRenderer[] = [claudeCodeRenderer, geminiCliRenderer, kiloCodeRenderer];
```

`kido init` loops over the *selected subset* of `AGENT_RENDERERS` instead of hardcoding Claude Code.

### Per-agent artifact mapping

| Agent | Auto-invoke artifact | Explicit command artifact |
|---|---|---|
| Claude Code (unchanged) | `.claude/skills/mr-<stage>/SKILL.md` (frontmatter: `name`, `description`, `allowed-tools`) | `.claude/commands/kido/<stage>.md` → `/kido:<stage>` |
| Gemini CLI | `.gemini/skills/mr-<stage>/SKILL.md` (same frontmatter shape, `allowed-tools` included) | `.gemini/commands/kido/<stage>.toml` (`description = "..."`, `prompt = '''<body>'''`) → `/kido:<stage>` |
| Kilo Code | *(none — no supported mechanism)* | `.kilo/commands/kido-<stage>.md` (frontmatter: `description` only) → `/kido-<stage>` |

All bodies are the same `stage.body` markdown already used for Claude Code — only the wrapper format changes per
agent, never the content.

TOML prompt bodies use a literal multi-line string (`'''...'''`) so markdown content (quotes, backticks, code
fences) doesn't need escaping; the one known edge case (a body containing the literal sequence `'''`) is
accepted as a non-issue today (no current stage body contains it) rather than engineered around preemptively.

Gemini CLI's skill folder keeps the `mr-` prefix (matching Claude Code's picker-collision rationale in
`claude-code.ts`) for naming consistency, even though Gemini's skills aren't typed via `/` the way commands are,
so the collision this avoids doesn't strictly apply there today.

### `kido init` agent selection

`InitOptions` gains `agents?: AgentId[]`.

Resolution order, in `runInit`:

1. **`options.agents` provided** (new `--agents <list>` CLI flag, comma-separated ids or `all`) → used directly,
   validated against `AGENT_RENDERERS`' known ids, error listing valid ids on an unknown value. Works with or
   without a TTY — this is the non-interactive path.
2. **No flag, TTY present** → new interactive checkbox prompt (below), Claude Code pre-checked, Gemini CLI and
   Kilo Code unchecked, user toggles with the pattern below and confirms with enter.
3. **No flag, no TTY** → defaults to `["claude"]`. This is byte-for-byte today's behavior (unconditional Claude
   Code generation, no prompt), so every existing non-interactive caller and the existing test suite keeps
   working unchanged.

Per an explicit decision made during this design, the selection is **asked every run** — no persisted "remembered
agents" config file. Re-running `kido init` after a Kido upgrade (e.g. to pick up a new/changed pipeline stage)
asks again rather than silently reusing a past choice.

### Checkbox prompt

`src/lib/prompt.ts` gains `PromptSession.askCheckbox`:

```ts
async askCheckbox<T extends string>(
  question: string,
  choices: { id: T; label: string }[],
  defaultSelected: T[]
): Promise<T[]>
```

Hand-rolled, no new dependency — consistent with `askYesNo`/`askText`'s existing zero-runtime-dependency
approach and `DESIGN.md`'s stated dependency philosophy. Implementation: pause the session's existing readline
interface, put `stdin` into raw mode via `readline.emitKeypressEvents`, render the choice list with `[x]`/`[ ]`
markers and a `>` cursor line, handle arrow up/down to move, space to toggle, enter to confirm; re-render in
place using ANSI cursor-up + clear-line; restore non-raw mode and resume the readline interface on exit
(including on Ctrl+C).

## Test changes

- `test/renderers-gemini.test.ts` — mirrors the existing Claude Code assertions in `test/init.test.ts`: given the
  stage list, asserts the exact set of generated `.gemini/skills/mr-*/SKILL.md` and
  `.gemini/commands/kido/*.toml` files, and spot-checks TOML content (`description`, `prompt` present, body
  matches `stage.body`).
- `test/renderers-kilo.test.ts` — same pattern for `.kilo/commands/kido-*.md`, asserting no skill-equivalent
  directory is created.
- `test/init.test.ts` — new cases for `{agents: [...]}` combinations, e.g. `{agents: ["claude", "gemini"]}`
  produces both `.claude/` and `.gemini/` trees and nothing under `.kilo/`; `{agents: ["kilo"]}` produces only
  `.kilo/commands/kido-*.md`. Existing no-`agents`-option cases are unchanged (still resolve to `["claude"]`
  under non-TTY test conditions) and must keep passing without modification.
- The raw-mode keypress loop in `askCheckbox` is UI plumbing that's impractical to unit-test in CI. The
  selection-*resolution* logic (flag parsing, TTY-vs-not branching, defaulting to `["claude"]`) is kept as a
  small, directly-testable piece of `init.ts` separate from the raw terminal-interaction code, so it's covered
  by the `test/init.test.ts` cases above without needing to simulate keypresses. The interactive checkbox itself
  gets a manual smoke check, same tier of verification `DESIGN.md` already applies to real generated skills.

## Docs

- `README.md`: Quick Start currently says `kido init` "generates six Claude Code skills/commands under
  `.claude/`" — becomes agent-count-dependent on the new picker; update to describe the checkbox/`--agents` flow
  and that Claude Code is only the pre-checked default, not the only target. (Note: separately from this design,
  the stage count is currently 7, soon 8 once `/kido:ask` lands — already stale before this change, worth fixing
  in the same pass.)
- `DESIGN.md`: remove "Gemini CLI / Kilo Code renderers" from "Scope explicitly excluded from v1"; add a new
  subsection describing the three renderers and the per-agent artifact mapping table above; update the
  repo-side file layout diagram to show `.gemini/` and `.kilo/` as parallel, equally-generated trees alongside
  `.claude/`.

## Out of scope

- Any auto-invoke equivalent for Kilo Code (custom modes rejected above as a structural mismatch — narrow
  one-shot orchestration scripts don't fit the "full persona" unit modes are built around).
- Persisting the agent selection across `kido init` runs.
- Argument-passing (`{{args}}` / `$ARGUMENTS`) support in any renderer — no current stage body needs it; the
  TOML/Kilo formats support it if a future stage ever does, but nothing in this design wires it up.
- Any change to `kido/docs/`, `kido/changes/`, or Jira-facing behavior — this design is entirely about where and
  how the pipeline stages get rendered into agent-specific files.
