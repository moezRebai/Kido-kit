import { existsSync } from "node:fs";
import { stdin } from "node:process";
import { ensureDir, isEmptyDir } from "../lib/fs-utils.js";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { PromptSession } from "../lib/prompt.js";
import { copyKidoDocs } from "../lib/docs-copy.js";
import { printWelcomeBanner } from "../lib/banner.js";
import { stages } from "../pipeline/definition.js";
import { AGENT_RENDERERS } from "../pipeline/renderers/registry.js";
import type { AgentId } from "../pipeline/renderers/types.js";
import {
  hasResolvableJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_ENV_VAR_NAMES,
  JIRA_CREDENTIALS_FILENAME,
  type JiraDeploymentType,
} from "../jira/credentials.js";

export interface InitOptions {
  /** Non-interactive: seed kido/docs/ from this legacy repo path (decision #59, --from-legacy). */
  fromLegacy?: string;
  /** Non-interactive: skip the legacy-docs question entirely, same as answering "no". */
  noLegacy?: boolean;
  /** Non-interactive: skip the Jira credentials question entirely. */
  skipJiraSetup?: boolean;
  /** Non-interactive: which agents to generate skills/commands for. Already validated (see parseAgentsFlag). */
  agents?: AgentId[];
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

  const isServer = await prompt.askYesNo("Is this a Server/Data Center instance?", false);
  const deploymentType: JiraDeploymentType = isServer ? "server" : "cloud";

  const baseUrl = await prompt.askText(
    isServer ? "Jira base URL (e.g. https://jira.yourcompany.com):" : "Jira base URL (e.g. https://yourteam.atlassian.net):"
  );
  const email = isServer ? undefined : await prompt.askText("Jira account email:");
  const apiToken = await prompt.askText(isServer ? "Jira Personal Access Token:" : "Jira API token:");
  const projectKey = await prompt.askText("Jira project key (e.g. PROJ):");
  writeJiraCredentialsFile(repoRoot, { baseUrl, email, apiToken, projectKey, deploymentType });
  console.log(`Wrote ${JIRA_CREDENTIALS_FILENAME} — Jira sync is ready to use.`);
}

async function resolveSelectedAgents(
  explicit: AgentId[] | undefined,
  prompt: PromptSession | undefined
): Promise<AgentId[]> {
  if (explicit && explicit.length > 0) return explicit;

  if (!prompt) return ["claude"];

  const choices = AGENT_RENDERERS.map((r) => ({ id: r.id, label: r.label }));
  return prompt.askCheckbox(
    "Which agent(s) do you want to generate skills/commands for? (space to toggle, enter to confirm)",
    choices,
    ["claude"]
  );
}

export async function runInit(repoRoot: string, options: InitOptions = {}): Promise<void> {
  printWelcomeBanner();

  const paths = resolveKidoPaths(repoRoot);

  ensureDir(paths.docsDir);
  ensureDir(paths.changesDir);
  ensureDir(paths.archiveDir);

  // Interactive prompts only when stdin is a real terminal — piped/non-TTY
  // input can race ahead of sequential readline question() calls (a known
  // Node gotcha), so scripted/automated callers should use the non-interactive
  // flags (--from-legacy/--no-legacy/--skip-jira-setup/--agents) instead.
  const prompt = stdin.isTTY ? new PromptSession() : undefined;
  try {
    const selectedAgentIds = await resolveSelectedAgents(options.agents, prompt);
    for (const agentId of selectedAgentIds) {
      const renderer = AGENT_RENDERERS.find((r) => r.id === agentId)!;
      renderer.render(stages, repoRoot);
    }
    const selectedLabels = selectedAgentIds.map((id) => AGENT_RENDERERS.find((r) => r.id === id)!.label).join(", ");
    console.log(`Scaffolded kido/ in ${repoRoot}`);
    console.log(`Generated skills/commands for ${selectedLabels} (stages: ${stages.map((s) => s.id).join(", ")})`);

    await handleDocsSetup(repoRoot, options, prompt);
    await handleJiraSetup(repoRoot, options, prompt);
  } finally {
    prompt?.close();
  }
}
