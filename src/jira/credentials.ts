import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export const JIRA_ENV_VAR_NAMES = [
  "KIDO_JIRA_BASE_URL",
  "KIDO_JIRA_EMAIL",
  "KIDO_JIRA_API_TOKEN",
  "KIDO_JIRA_PROJECT_KEY",
] as const;

export const JIRA_CREDENTIALS_FILENAME = ".kido-credentials";

type MaybeJiraCredentials = { [K in keyof JiraCredentials]?: string | undefined };

function fromEnv(): MaybeJiraCredentials {
  return {
    baseUrl: process.env.KIDO_JIRA_BASE_URL,
    email: process.env.KIDO_JIRA_EMAIL,
    apiToken: process.env.KIDO_JIRA_API_TOKEN,
    projectKey: process.env.KIDO_JIRA_PROJECT_KEY,
  };
}

function fromFile(repoRoot: string): MaybeJiraCredentials {
  const fallbackPath = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  if (!existsSync(fallbackPath)) return {};
  try {
    return JSON.parse(readFileSync(fallbackPath, "utf8"));
  } catch {
    return {};
  }
}

function isComplete(creds: MaybeJiraCredentials): creds is JiraCredentials {
  return Boolean(creds.baseUrl && creds.email && creds.apiToken && creds.projectKey);
}

/** Non-throwing check — used by `kido init` to decide whether to offer setup at all. */
export function hasResolvableJiraCredentials(repoRoot: string): boolean {
  return isComplete(fromEnv()) || isComplete(fromFile(repoRoot));
}

/**
 * Resolves Jira credentials: user-scoped env vars first (decision #16),
 * falling back to a gitignored local file at the repo root. Never touches
 * machine-wide env vars or requires elevated privileges.
 */
export function resolveJiraCredentials(repoRoot: string): JiraCredentials {
  const envCreds = fromEnv();
  if (isComplete(envCreds)) return envCreds;

  const fileCreds = fromFile(repoRoot);
  if (isComplete(fileCreds)) return fileCreds;

  throw new Error(
    `Jira credentials not found. Set ${JIRA_ENV_VAR_NAMES.join(", ")} ` +
      `as user-scoped environment variables, or create ${JIRA_CREDENTIALS_FILENAME} (gitignored) with { "baseUrl", "email", "apiToken", "projectKey" }.`
  );
}

/** Writes the credentials file directly — used by `kido init`'s optional first-time setup prompt. */
export function writeJiraCredentialsFile(repoRoot: string, creds: JiraCredentials): void {
  const path = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", "utf8");
}
