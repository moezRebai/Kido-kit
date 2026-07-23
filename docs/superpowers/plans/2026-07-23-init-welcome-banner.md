# Kido Init Welcome Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kido init` prints an OpenSpec-style welcome banner (robot logo, title, tagline, "this will configure" list, quick-start pipeline) as the very first thing it does, before any scaffolding work.

**Architecture:** One new pure-presentation module, `src/lib/banner.ts`, exporting `printWelcomeBanner(): void`. `runInit()` in `src/commands/init.ts` calls it as its first statement. No other behavior in `runInit()` changes.

**Tech Stack:** TypeScript, Node.js built-ins only (`node:test` for tests, raw ANSI escape codes for color — project has zero runtime dependencies today and this must not add one).

## Global Constraints

- No new runtime dependency — use raw ANSI escape codes, not a color library.
- Color output only when `process.stdout.isTTY` is `true` AND `process.env.NO_COLOR` is unset. Otherwise print plain text.
- The banner is the first thing `runInit()` does — before `ensureDir`, before any scaffolding, before the existing `Scaffolded kido/ in ...` / `Generated .claude/...` console lines.
- Do not modify the existing post-scaffold confirmation lines or the interactive prompt flow in `runInit()` — the banner is additive.
- Banner text is exactly: title "Welcome to Kido", tagline "Spec-driven BA/Dev collaboration for microservices", configure bullets for `kido/docs/` + `kido/changes/` scaffolding and Claude Code skills/commands under `.claude/`, quick-start line `/kido:specify  ->  /kido:apply  ->  /kido:archive`, and trailing lead-in "Setting up...".

---

### Task 1: `printWelcomeBanner()` in `src/lib/banner.ts`

**Files:**
- Create: `src/lib/banner.ts`
- Test: `test/banner.test.ts`

**Interfaces:**
- Produces: `export function printWelcomeBanner(): void` — later tasks (Task 2) import this from `../lib/banner.js`.

- [ ] **Step 1: Write the failing test**

Create `test/banner.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { printWelcomeBanner } from "../src/lib/banner.js";

test("printWelcomeBanner prints the Kido welcome banner without throwing", () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    printWelcomeBanner();
  } finally {
    console.log = originalLog;
  }
  const output = lines.join("\n");
  assert.match(output, /Welcome to Kido/);
  assert.match(output, /Spec-driven BA\/Dev collaboration for microservices/);
  assert.match(output, /This setup will configure:/);
  assert.match(output, /kido\/docs\/ \+ kido\/changes\/ scaffolding/);
  assert.match(output, /Claude Code skills\/commands under \.claude\//);
  assert.match(output, /Quick start after setup:/);
  assert.match(output, /\/kido:specify\s+->\s+\/kido:apply\s+->\s+\/kido:archive/);
  assert.match(output, /Setting up\.\.\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/banner.test.js`
Expected: FAIL — `src/lib/banner.ts` doesn't exist yet (build error or module-not-found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/banner.ts`:

```ts
// ANSI color for the `kido init` welcome banner. No color library — this
// project has zero runtime dependencies and that should stay true.
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";

interface BannerRow {
  /** Left column: part of the robot glyph for this row, or spaces if the robot doesn't extend this far. */
  robot: string;
  text: string;
  bold?: boolean;
}

// Robot glyph column is a fixed 13-char field so every row lines up;
// each glyph is centered within it.
const BLANK_ROBOT = " ".repeat(13);

const ROWS: BannerRow[] = [
  { robot: "      o      ", text: "" },
  { robot: "      |      ", text: "" },
  { robot: "    #####    ", text: "Welcome to Kido", bold: true },
  { robot: "    #o#o#    ", text: "Spec-driven BA/Dev collaboration for microservices" },
  { robot: "    #####    ", text: "" },
  { robot: "     # #     ", text: "This setup will configure:" },
  { robot: "    ## ##    ", text: "  • kido/docs/ + kido/changes/ scaffolding" },
  { robot: BLANK_ROBOT, text: "  • Claude Code skills/commands under .claude/" },
  { robot: BLANK_ROBOT, text: "" },
  { robot: BLANK_ROBOT, text: "Quick start after setup:" },
  { robot: BLANK_ROBOT, text: "  /kido:specify  ->  /kido:apply  ->  /kido:archive" },
  { robot: BLANK_ROBOT, text: "" },
  { robot: BLANK_ROBOT, text: "Setting up..." },
];

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

export function printWelcomeBanner(): void {
  const color = supportsColor();
  console.log();
  for (const row of ROWS) {
    const robot = color ? `${CYAN}${row.robot}${RESET}` : row.robot;
    const text = color && row.bold ? `${BOLD}${row.text}${RESET}` : row.text;
    console.log(`${robot}  ${text}`.trimEnd());
  }
  console.log();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/banner.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Manual visual check**

Create a scratch file `scratch-banner-check.mjs` at the repo root:

```js
import { printWelcomeBanner } from "./dist/lib/banner.js";
printWelcomeBanner();
```

Run: `node scratch-banner-check.mjs`

Expected: a readable robot face (ball, stem, head with two eyes, head, neck, legs) with the wordmark/tagline/bullets/quick-start text aligned to its right, no ragged/overlapping columns. Adjust the `robot`/`text` strings in `ROWS` if anything looks off, then re-run `npm run build && node scratch-banner-check.mjs` until it looks right.

Delete `scratch-banner-check.mjs` when done (it's a throwaway check, not part of the codebase).

- [ ] **Step 6: Commit**

```bash
git add src/lib/banner.ts test/banner.test.ts
git commit -m "Add kido init welcome banner (robot logo + quick start)"
```

---

### Task 2: Wire the banner into `kido init`

**Files:**
- Modify: `src/commands/init.ts:1-16` (imports) and `src/commands/init.ts:109-113` (top of `runInit`)

**Interfaces:**
- Consumes: `printWelcomeBanner(): void` from Task 1 (`../lib/banner.js`).

- [ ] **Step 1: Add the import**

In `src/commands/init.ts`, add to the top import block (after the existing imports, before the `JIRA_ENV_VAR_NAMES` import group is fine too — just keep it with the other `../lib/*` imports):

```ts
import { printWelcomeBanner } from "../lib/banner.js";
```

- [ ] **Step 2: Call it first in `runInit`**

Change:

```ts
export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  const paths = resolveKidoPaths(repoRoot);
```

to:

```ts
export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  printWelcomeBanner();

  const paths = resolveKidoPaths(repoRoot);
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the existing `test/init.test.ts` and `test/init-jira-setup.test.ts` suites (they assert on filesystem state, not console output, so the added banner shouldn't break them) and the new `test/banner.test.ts` from Task 1.

- [ ] **Step 4: Manual end-to-end check**

Run (from a scratch temp directory, e.g. `mkdtemp` equivalent — anywhere outside this repo):

```bash
mkdir /tmp/kido-banner-check && cd /tmp/kido-banner-check
node /path/to/Kido/dist/cli.js init --no-legacy --skip-jira-setup
```

Expected: the welcome banner prints first, followed by the existing `Scaffolded kido/ in ...` / `Generated .claude/...` lines. Colors render if run in a real terminal.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts
git commit -m "Print welcome banner at the start of kido init"
```
