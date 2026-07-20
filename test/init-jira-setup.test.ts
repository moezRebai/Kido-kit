import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { JIRA_CREDENTIALS_FILENAME } from "../src/jira/credentials.js";

function makeEmptyRepo(): string {
  return mkdtempSync(join(tmpdir(), "kido-test-init-jira-"));
}

// These tests run in a non-TTY context (node:test), so runInit's Jira setup
// takes the "no terminal to ask interactively" branch — that's exactly the
// behavior worth locking in: it must never hang or throw, only ever guide.

test("with no Jira credentials configured and no TTY, init does not write a credentials file or throw", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  try {
    delete process.env.KIDO_JIRA_BASE_URL;
    delete process.env.KIDO_JIRA_EMAIL;
    delete process.env.KIDO_JIRA_API_TOKEN;
    delete process.env.KIDO_JIRA_PROJECT_KEY;

    await runInit(repo, { noLegacy: true });

    assert.equal(existsSync(join(repo, JIRA_CREDENTIALS_FILENAME)), false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--skip-jira-setup skips the question even with nothing configured", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  try {
    delete process.env.KIDO_JIRA_BASE_URL;
    delete process.env.KIDO_JIRA_EMAIL;
    delete process.env.KIDO_JIRA_API_TOKEN;
    delete process.env.KIDO_JIRA_PROJECT_KEY;

    await runInit(repo, { noLegacy: true, skipJiraSetup: true });

    assert.equal(existsSync(join(repo, JIRA_CREDENTIALS_FILENAME)), false);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("when credentials are already resolvable via env vars, init doesn't touch the credentials file", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  try {
    process.env.KIDO_JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.KIDO_JIRA_EMAIL = "someone@example.com";
    process.env.KIDO_JIRA_API_TOKEN = "token";
    process.env.KIDO_JIRA_PROJECT_KEY = "PROJ";

    await runInit(repo, { noLegacy: true });

    assert.equal(existsSync(join(repo, JIRA_CREDENTIALS_FILENAME)), false, "already-resolvable creds should short-circuit before any file write");
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});

test("when credentials are already resolvable via an existing file, init doesn't overwrite it", async () => {
  const repo = makeEmptyRepo();
  const originalEnv = { ...process.env };
  try {
    delete process.env.KIDO_JIRA_BASE_URL;
    delete process.env.KIDO_JIRA_EMAIL;
    delete process.env.KIDO_JIRA_API_TOKEN;
    delete process.env.KIDO_JIRA_PROJECT_KEY;

    const existing = { baseUrl: "https://existing.atlassian.net", email: "a@b.com", apiToken: "tok", projectKey: "EXIST" };
    const credsPath = join(repo, JIRA_CREDENTIALS_FILENAME);
    writeFileSync(credsPath, JSON.stringify(existing));

    await runInit(repo, { noLegacy: true });

    const stillThere = JSON.parse(readFileSync(credsPath, "utf8"));
    assert.deepEqual(stillThere, existing);
  } finally {
    process.env = originalEnv;
    rmSync(repo, { recursive: true, force: true });
  }
});
