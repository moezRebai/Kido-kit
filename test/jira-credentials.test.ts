import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasResolvableJiraCredentials,
  resolveJiraCredentials,
  writeJiraCredentialsFile,
  JIRA_CREDENTIALS_FILENAME,
} from "../src/jira/credentials.js";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-jira-creds-"));
}

function clearJiraEnv(): void {
  delete process.env.KIDO_JIRA_BASE_URL;
  delete process.env.KIDO_JIRA_EMAIL;
  delete process.env.KIDO_JIRA_API_TOKEN;
  delete process.env.KIDO_JIRA_PROJECT_KEY;
  delete process.env.KIDO_JIRA_DEPLOYMENT_TYPE;
  delete process.env.KIDO_JIRA_ALLOW_INSECURE_TLS;
}

test("cloud credentials require email; deploymentType defaults to cloud when unset in the file", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({ baseUrl: "https://x.atlassian.net", email: "a@b.com", apiToken: "tok", projectKey: "PROJ" })
    );

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.deploymentType, "cloud");
    assert.equal(creds.email, "a@b.com");
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("server credentials don't require email", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({
        baseUrl: "https://jira.company.com",
        apiToken: "pat-token",
        projectKey: "PROJ",
        deploymentType: "server",
      })
    );

    assert.equal(hasResolvableJiraCredentials(repo), true);
    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.deploymentType, "server");
    assert.equal(creds.email, undefined);
    assert.equal(creds.apiToken, "pat-token");
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("server credentials missing apiToken are NOT resolvable, even with baseUrl and projectKey set", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({ baseUrl: "https://jira.company.com", deploymentType: "server", projectKey: "PROJ" })
    );

    assert.equal(hasResolvableJiraCredentials(repo), false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("allowInsecureTls normalizes the string \"true\" from env vars to a real boolean", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    process.env.KIDO_JIRA_BASE_URL = "https://jira.company.com";
    process.env.KIDO_JIRA_API_TOKEN = "pat-token";
    process.env.KIDO_JIRA_PROJECT_KEY = "PROJ";
    process.env.KIDO_JIRA_DEPLOYMENT_TYPE = "server";
    process.env.KIDO_JIRA_ALLOW_INSECURE_TLS = "true";

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.allowInsecureTls, true);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("allowInsecureTls defaults to false when unset", () => {
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  try {
    clearJiraEnv();
    writeFileSync(
      join(repo, JIRA_CREDENTIALS_FILENAME),
      JSON.stringify({
        baseUrl: "https://jira.company.com",
        apiToken: "pat-token",
        projectKey: "PROJ",
        deploymentType: "server",
      })
    );

    const creds = resolveJiraCredentials(repo);
    assert.equal(creds.allowInsecureTls, false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("writeJiraCredentialsFile writes deploymentType and omits email for server credentials", () => {
  const repo = makeRepo();
  try {
    writeJiraCredentialsFile(repo, {
      baseUrl: "https://jira.company.com",
      apiToken: "pat-token",
      projectKey: "PROJ",
      deploymentType: "server",
    });

    const written = JSON.parse(readFileSync(join(repo, JIRA_CREDENTIALS_FILENAME), "utf8"));
    assert.equal(written.deploymentType, "server");
    assert.equal(written.email, undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
