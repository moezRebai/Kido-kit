import { existsSync } from "node:fs";
import { join } from "node:path";
import { stdin } from "node:process";
import { ensureDir, isEmptyDir } from "../lib/fs-utils.js";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { PromptSession } from "../lib/prompt.js";
import { copyKidoDocs } from "../lib/docs-copy.js";
import { stages } from "../pipeline/definition.js";
import { renderAllClaudeCodeStages } from "../pipeline/renderers/claude-code.js";
import {
  hasResolvableJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_ENV_VAR_NAMES,
  JIRA_CREDENTIALS_FILENAME,
} from "../jira/credentials.js";

export interface InitOptions {
  /** Non-interactive: seed kido/docs/ from this legacy repo path (decision #59, --from-legacy). */
  fromLegacy?: string;
  /** Non-interactive: skip the legacy-docs question entirely, same as answering "no". */
  noLegacy?: boolean;
  /** Non-interactive: skip the Jira credentials question entirely. */
  skipJiraSetup?: boolean;
}

function seedFromLegacy(repoRoot: string, legacyPath: string): void {
  if (!existsSync(legacyPath)) {
    console.log(`Warning: ${legacyPath} does not exist. Skipping seed — run \`kido docs export\` manually later.`);
    return;
  }
  const result = copyKidoDocs(legacyPath, repoRoot);
  if (result.copied) {
    console.log(`Copied kido/docs/ from ${legacyPath}. Run /kido:specify next to adapt it for this project (or /kido:document first if this repo already has real code to discover).`);
  } else {
    console.log(`Could not seed from legacy repo: ${result.reason}`);
  }
}

async function handleDocsSetup(repoRoot: string, options: InitOptions, prompt: PromptSession | undefined): Promise<void> {
  const paths = resolveKidoPaths(repoRoot);
  if (!isEmptyDir(paths.docsDir)) {
    return;
  }

  if (options.fromLegacy) {
    seedFromLegacy(repoRoot, options.fromLegacy);
    return;
  }
  if (options.noLegacy) {
    console.log("No legacy docs to seed from — run /kido:specify next, it'll build kido/docs/ and your first spec together.");
    return;
  }
  if (!prompt) {
    console.log(
      "No /docs yet, and no terminal to ask interactively — pass --from-legacy <path> to seed from a legacy repo, " +
        "or --no-legacy to skip, then run /kido:specify (or /kido:document first if this repo already has real code)."
    );
    return;
  }

  const hasLegacy = await prompt.askYesNo("Do you have legacy docs / a legacy repo to seed kido/docs/ from?", false);
  if (hasLegacy) {
    const legacyPath = await prompt.askText("Path to the legacy repo (containing its own kido/docs/):");
    seedFromLegacy(repoRoot, legacyPath);
  } else {
    console.log("No legacy docs to seed from — run /kido:specify next, it'll build kido/docs/ and your first spec together.");
  }
}

async function handleJiraSetup(repoRoot: string, options: InitOptions, prompt: PromptSession | undefined): Promise<void> {
  if (options.skipJiraSetup) return;
  if (hasResolvableJiraCredentials(repoRoot)) return;

  if (!prompt) {
    console.log(
      `No Jira credentials configured yet, and no terminal to ask interactively — set ${JIRA_ENV_VAR_NAMES.join(", ")} ` +
        `as env vars, or create ${JIRA_CREDENTIALS_FILENAME}, before running \`kido jira sync\`.`
    );
    return;
  }

  const wantsSetup = await prompt.askYesNo("No Jira credentials configured yet. Set them up now?", false);
  if (!wantsSetup) {
    console.log(
      `Skipping Jira setup — configure it later (\`kido jira sync\` needs ${JIRA_ENV_VAR_NAMES.join(", ")} as env vars, ` +
        `or a ${JIRA_CREDENTIALS_FILENAME} file).`
    );
    return;
  }

  const useFile = await prompt.askYesNo(
    `Store credentials in a local ${JIRA_CREDENTIALS_FILENAME} file (gitignored)? (answering no means setting up environment variables yourself instead)`,
    true
  );
  if (!useFile) {
    console.log("Set these user-scoped environment variables, then Jira sync will work automatically:");
    for (const name of JIRA_ENV_VAR_NAMES) console.log(`  ${name}`);
    return;
  }

  const baseUrl = await prompt.askText("Jira base URL (e.g. https://yourteam.atlassian.net):");
  const email = await prompt.askText("Jira account email:");
  const apiToken = await prompt.askText("Jira API token:");
  const projectKey = await prompt.askText("Jira project key (e.g. PROJ):");
  writeJiraCredentialsFile(repoRoot, { baseUrl, email, apiToken, projectKey });
  console.log(`Wrote ${JIRA_CREDENTIALS_FILENAME} — Jira sync is ready to use.`);
}

export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  const paths = resolveKidoPaths(repoRoot);

  ensureDir(paths.docsDir);
  ensureDir(paths.changesDir);
  ensureDir(paths.archiveDir);

  const claudeDir = join(repoRoot, ".claude");
  renderAllClaudeCodeStages(stages, claudeDir);

  console.log(`Scaffolded kido/ in ${repoRoot}`);
  console.log(`Generated .claude/skills/mr-* and .claude/commands/kido/* for: ${stages.map((s) => s.id).join(", ")}`);

  // Interactive prompts only when stdin is a real terminal — piped/non-TTY
  // input can race ahead of sequential readline question() calls (a known
  // Node gotcha), so scripted/automated callers should use the non-interactive
  // flags (--from-legacy/--no-legacy/--skip-jira-setup) instead.
  const prompt = stdin.isTTY ? new PromptSession() : undefined;
  try {
    await handleDocsSetup(repoRoot, options, prompt);
    await handleJiraSetup(repoRoot, options, prompt);
  } finally {
    prompt?.close();
  }
}
