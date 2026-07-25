import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type JiraDeploymentType = "cloud" | "server";

export interface JiraCredentials {
  baseUrl: string;
  /** Server/Data Center doesn't use this — Personal Access Token auth needs no email. */
  email?: string;
  apiToken: string;
  projectKey: string;
  deploymentType: JiraDeploymentType;
  /** Disables TLS certificate verification for this client's requests — insecure, last resort.
   * Prefer NODE_EXTRA_CA_CERTS for a self-signed/internal-CA Server/DC instance instead. */
  allowInsecureTls?: boolean;
}

export const JIRA_ENV_VAR_NAMES = [
  "KIDO_JIRA_BASE_URL",
  "KIDO_JIRA_EMAIL",
  "KIDO_JIRA_API_TOKEN",
  "KIDO_JIRA_PROJECT_KEY",
  "KIDO_JIRA_DEPLOYMENT_TYPE",
  "KIDO_JIRA_ALLOW_INSECURE_TLS",
] as const;

export const JIRA_CREDENTIALS_FILENAME = ".kido-credentials";

interface RawJiraCredentials {
  baseUrl?: string | undefined;
  email?: string | undefined;
  apiToken?: string | undefined;
  projectKey?: string | undefined;
  deploymentType?: string | undefined;
  allowInsecureTls?: string | boolean | undefined;
}

function fromEnv(): RawJiraCredentials {
  return {
    baseUrl: process.env.KIDO_JIRA_BASE_URL,
    email: process.env.KIDO_JIRA_EMAIL,
    apiToken: process.env.KIDO_JIRA_API_TOKEN,
    projectKey: process.env.KIDO_JIRA_PROJECT_KEY,
    deploymentType: process.env.KIDO_JIRA_DEPLOYMENT_TYPE,
    allowInsecureTls: process.env.KIDO_JIRA_ALLOW_INSECURE_TLS,
  };
}

function fromFile(repoRoot: string): RawJiraCredentials {
  const fallbackPath = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  if (!existsSync(fallbackPath)) return {};
  try {
    return JSON.parse(readFileSync(fallbackPath, "utf8"));
  } catch {
    return {};
  }
}

function isComplete(creds: RawJiraCredentials): boolean {
  if (creds.deploymentType === "server") {
    return Boolean(creds.baseUrl && creds.apiToken && creds.projectKey);
  }
  return Boolean(creds.baseUrl && creds.email && creds.apiToken && creds.projectKey);
}

function normalize(creds: RawJiraCredentials): JiraCredentials {
  return {
    baseUrl: creds.baseUrl!,
    email: creds.email,
    apiToken: creds.apiToken!,
    projectKey: creds.projectKey!,
    deploymentType: creds.deploymentType === "server" ? "server" : "cloud",
    allowInsecureTls: creds.allowInsecureTls === true || creds.allowInsecureTls === "true",
  };
}

/** Non-throwing check — used by `kido init` to decide whether to offer setup at all. */
export function hasResolvableJiraCredentials(repoRoot: string): boolean {
  return isComplete(fromEnv()) || isComplete(fromFile(repoRoot));
}

/**
 * Resolves Jira credentials: user-scoped env vars first (decision #16),
 * falling back to a gitignored local file at the repo root. Never touches
 * machine-wide env vars or requires elevated privileges. `deploymentType`
 * is "cloud" (default, including when unset) or "server" — server mode
 * doesn't require `email` (Personal Access Token auth instead of Basic).
 */
export function resolveJiraCredentials(repoRoot: string): JiraCredentials {
  const envCreds = fromEnv();
  if (isComplete(envCreds)) return normalize(envCreds);

  const fileCreds = fromFile(repoRoot);
  if (isComplete(fileCreds)) return normalize(fileCreds);

  throw new Error(
    `Jira credentials not found. Set ${JIRA_ENV_VAR_NAMES.join(", ")} ` +
      `as user-scoped environment variables, or create ${JIRA_CREDENTIALS_FILENAME} (gitignored) with ` +
      `{ "baseUrl", "email"?, "apiToken", "projectKey", "deploymentType"?, "allowInsecureTls"? } — ` +
      `"email" is only required when "deploymentType" is "cloud" (the default).`
  );
}

/** Writes the credentials file directly — used by `kido init`'s optional first-time setup prompt. */
export function writeJiraCredentialsFile(repoRoot: string, creds: JiraCredentials): void {
  const path = join(repoRoot, JIRA_CREDENTIALS_FILENAME);
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", "utf8");
}
