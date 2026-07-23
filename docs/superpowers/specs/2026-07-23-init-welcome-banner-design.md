# `kido init` welcome banner

## Problem

`kido init` currently starts working silently and only prints confirmation lines
after scaffolding is done (`Scaffolded kido/ in ...`, `Generated .claude/...`).
A first-time user gets no framing for what the tool is or what's about to
happen, unlike OpenSpec's `init` command, which opens with a logo, a one-line
pitch, a "this will configure" list, and a quick-start cheat sheet before doing
any work.

## Goals

- Print a welcome banner as the very first thing `kido init` does, before any
  scaffolding.
- Give the banner a small ASCII robot logo, a "Welcome to Kido" title, and the
  existing package tagline.
- Tell the user up front what init will set up, and how to start using it
  afterward (the `/kido:specify -> /kido:apply -> /kido:archive` pipeline).
- Zero new dependencies (project has none today) — raw ANSI escape codes,
  color only when safe.

## Non-goals

- No interactive tool-picker step (unlike OpenSpec) — Kido's init already has
  its own legacy-docs/Jira prompts later in the flow; the banner doesn't
  replace or duplicate those.
- Not touching the existing post-scaffold confirmation lines
  (`Scaffolded kido/ in ...` / `Generated .claude/...`) — those stay as
  dynamic, accurate-to-what-happened output after the static banner.

## Design

### New file: `src/lib/banner.ts`

Exports one function:

```ts
export function printWelcomeBanner(): void
```

Prints the banner below to stdout. Colors (robot logo: cyan, "Welcome to
Kido": bold, everything else: default/dim where noted) are applied only when
`process.stdout.isTTY` is true and `process.env.NO_COLOR` is unset — standard
convention, keeps CI logs and piped output plain. Implemented with raw ANSI
escape codes (no new dependency).

Exact content (color notes in brackets, not part of literal output):

```
         o
         |
       #####          Welcome to Kido            [bold]
       #o#o#          Spec-driven BA/Dev collaboration for microservices
       #####
        # #           This setup will configure:
       ## ##            • kido/docs/ + kido/changes/ scaffolding
                         • Claude Code skills/commands under .claude/

                       Quick start after setup:
                         /kido:specify  ->  /kido:apply  ->  /kido:archive

                       Setting up...
```

- Robot logo (the `o`/`|`/`#####`/`#o#o#`/`# #`/`## ##` block, left column):
  cyan.
- "Welcome to Kido": bold.
- Everything else: default terminal color (no dimming) — keep it simple and
  legible, avoid dim-text-on-dark-terminal readability issues.
- The trailing blank line + "Setting up..." is the transition cue into the
  existing scaffolding output that already prints dynamically
  (`Scaffolded kido/ in ...`, etc.).

### Call site

`src/commands/init.ts`, top of `runInit()`:

```ts
export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  printWelcomeBanner();

  const paths = resolveKidoPaths(repoRoot);
  ensureDir(paths.docsDir);
  ...
```

Nothing else in `runInit()` changes — the existing confirmation lines and
interactive prompts (legacy docs, Jira setup) run exactly as they do today,
after the banner.

## Testing

A test in `src/lib/banner.test.ts` (built/run the same way as the rest of the
`src/lib` tests):

- Stub `console.log`, call `printWelcomeBanner()`, assert it doesn't throw and
  that the captured output contains `"Welcome to Kido"`, the tagline text, and
  `"/kido:specify"`.
- No snapshot of exact ANSI byte sequences — that's brittle and not the part
  of the behavior worth locking down.

## Open questions

None — content, placement, and styling were confirmed interactively before
writing this spec.
