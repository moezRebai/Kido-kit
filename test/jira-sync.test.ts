import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKidoPaths } from "../src/lib/kido-paths.js";
import { runNewChange } from "../src/commands/new-change.js";
import { runJiraSync } from "../src/commands/jira-sync.js";
import { parseFrontmatter } from "../src/lib/frontmatter.js";

/** A minimal fake Jira Cloud REST API — just enough of /rest/api/3/issue(/:key) and
 * /transitions to exercise JiraClient's create/update paths without real credentials. */
interface FakeIssueFields {
  summary: string;
  issuetype: { name: string };
  parent?: { key: string };
}

function startFakeJira(): Promise<{ server: Server; url: string; issues: Map<string, FakeIssueFields>; nextId: { n: number } }> {
  const issues = new Map<string, FakeIssueFields>();
  const nextId = { n: 1 };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;

      if (req.method === "POST" && req.url === "/rest/api/3/issue") {
        const key = `TEST-${nextId.n++}`;
        issues.set(key, body.fields);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const updateMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(req.url ?? "");
      if (req.method === "PUT" && updateMatch) {
        const key = updateMatch[1]!;
        issues.set(key, { ...(issues.get(key) as object), ...body.fields });
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, issues, nextId });
    });
  });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-jira-"));
  const paths = resolveKidoPaths(dir);
  mkdirSync(paths.docsDir, { recursive: true });
  mkdirSync(paths.changesDir, { recursive: true });
  mkdirSync(paths.archiveDir, { recursive: true });
  return dir;
}

test("jira sync creates an Epic from functional-spec.md and Stories from tasks.md, writing IDs back for idempotency", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    process.env.KIDO_JIRA_BASE_URL = url;
    process.env.KIDO_JIRA_EMAIL = "test@example.com";
    process.env.KIDO_JIRA_API_TOKEN = "fake-token";
    process.env.KIDO_JIRA_PROJECT_KEY = "TEST";

    runNewChange(repo, "Add Swap Pricing", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("add-swap-pricing");
    writeFileSync(join(changeDir, "functional-spec.md"), "# Swap Pricing\n\nBAs need to price swaps.");
    writeFileSync(
      join(changeDir, "tasks.md"),
      [
        "## Task 1: Add calculator",
        "",
        "Implement it.",
        "",
        "**Depends on:** none",
        "**Test:** unit test passes",
      ].join("\n")
    );

    await runJiraSync(repo, "add-swap-pricing");

    // Epic created and its key written back into functional-spec.md's frontmatter.
    const specContent = readFileSync(join(changeDir, "functional-spec.md"), "utf8");
    const { frontmatter: specFm } = parseFrontmatter(specContent);
    assert.equal(specFm.jiraId, "TEST-1");
    assert.equal(issues.get("TEST-1")!.summary, "Swap Pricing");
    assert.equal(issues.get("TEST-1")!.issuetype.name, "Epic");

    // Story created under that Epic, with an inline **Jira:** marker in tasks.md.
    const tasksContent = readFileSync(join(changeDir, "tasks.md"), "utf8");
    assert.match(tasksContent, /\*\*Jira:\*\* TEST-2/);
    assert.equal(issues.get("TEST-2")!.issuetype.name, "Story");
    assert.equal(issues.get("TEST-2")!.parent!.key, "TEST-1");

    // Re-syncing should UPDATE the same two issues, not create new ones.
    await runJiraSync(repo, "add-swap-pricing");
    assert.equal(issues.size, 2, "re-sync must update by stored ID, not create duplicates");
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("jira sync for a bug.md creates a Bug ticket", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    process.env.KIDO_JIRA_BASE_URL = url;
    process.env.KIDO_JIRA_EMAIL = "test@example.com";
    process.env.KIDO_JIRA_API_TOKEN = "fake-token";
    process.env.KIDO_JIRA_PROJECT_KEY = "TEST";

    runNewChange(repo, "Fix Login Crash", "bug");
    const changeDir = resolveKidoPaths(repo).changeDir("fix-login-crash");
    writeFileSync(join(changeDir, "bug.md"), "# Login crashes on empty password\n\nRepro: submit empty password.");

    await runJiraSync(repo, "fix-login-crash");

    const bugContent = readFileSync(join(changeDir, "bug.md"), "utf8");
    const { frontmatter } = parseFrontmatter(bugContent);
    assert.equal(frontmatter.jiraId, "TEST-1");
    assert.equal(issues.get("TEST-1")!.issuetype.name, "Bug");
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("--epic pins Stories to an existing Epic, taking priority even when functional-spec.md would auto-create its own", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    process.env.KIDO_JIRA_BASE_URL = url;
    process.env.KIDO_JIRA_EMAIL = "test@example.com";
    process.env.KIDO_JIRA_API_TOKEN = "fake-token";
    process.env.KIDO_JIRA_PROJECT_KEY = "TEST";

    runNewChange(repo, "Internal Refactor", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("internal-refactor");
    // Dev-only entry: no functional-spec.md at all.
    writeFileSync(
      join(changeDir, "tasks.md"),
      ["## Task 1: Refactor caching layer", "", "Internal only.", "", "**Depends on:** none", "**Test:** existing tests still pass"].join("\n")
    );

    await runJiraSync(repo, "internal-refactor", "PROJ-999");

    const tasksContent = readFileSync(join(changeDir, "tasks.md"), "utf8");
    const storyKeyMatch = /\*\*Jira:\*\*\s*(\S+)/.exec(tasksContent);
    assert.ok(storyKeyMatch, "expected a Jira story marker in tasks.md");
    assert.equal(issues.get(storyKeyMatch![1]!)!.parent!.key, "PROJ-999");
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});
