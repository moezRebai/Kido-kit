import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKidoPaths } from "../src/lib/kido-paths.js";
import { runNewChange } from "../src/commands/new-change.js";
import { runJiraSync } from "../src/commands/jira-sync.js";
import { runJiraPull } from "../src/commands/jira-pull.js";
import { parseFrontmatter } from "../src/lib/frontmatter.js";
import { parseTasks } from "../src/lib/tasks-parser.js";

/** A fuller fake Jira Cloud REST API than jira-sync.test.ts's — adds GET /issue/:key
 * and GET /search (JQL `parent = X`) on top of create/update, so it can exercise
 * jira-pull.ts's read path as well as jira-sync.ts's write path in the same test. */
interface FakeIssue {
  key: string;
  fields: {
    summary: string;
    issuetype: { name: string };
    description?: unknown;
    parent?: { key: string };
  };
  order: number;
}

function startFakeJira(): Promise<{ server: Server; url: string; issues: Map<string, FakeIssue> }> {
  const issues = new Map<string, FakeIssue>();
  let nextId = 1;
  let order = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      const url = new URL(req.url ?? "", "http://localhost");

      if (req.method === "POST" && url.pathname === "/rest/api/3/issue") {
        const key = `TEST-${nextId++}`;
        issues.set(key, { key, fields: body.fields, order: order++ });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const issueMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "PUT" && issueMatch) {
        const key = issueMatch[1]!;
        const existing = issues.get(key)!;
        issues.set(key, { ...existing, fields: { ...existing.fields, ...body.fields } });
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && issueMatch) {
        const key = issueMatch[1]!;
        const issue = issues.get(key);
        if (!issue) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key: issue.key, fields: issue.fields }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/api/3/search") {
        const jql = url.searchParams.get("jql") ?? "";
        const parentMatch = /parent\s*=\s*(\S+)/.exec(jql);
        const parentKey = parentMatch?.[1];
        const matches = [...issues.values()]
          .filter((issue) => issue.fields.parent?.key === parentKey)
          .sort((a, b) => a.order - b.order)
          .map((issue) => ({ key: issue.key, fields: issue.fields }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issues: matches }));
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
      resolve({ server, url: `http://127.0.0.1:${port}`, issues });
    });
  });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kido-test-jira-pull-"));
  const paths = resolveKidoPaths(dir);
  mkdirSync(paths.docsDir, { recursive: true });
  mkdirSync(paths.changesDir, { recursive: true });
  mkdirSync(paths.archiveDir, { recursive: true });
  return dir;
}

function setJiraEnv(url: string): void {
  process.env.KIDO_JIRA_BASE_URL = url;
  process.env.KIDO_JIRA_EMAIL = "test@example.com";
  process.env.KIDO_JIRA_API_TOKEN = "fake-token";
  process.env.KIDO_JIRA_PROJECT_KEY = "TEST";
}

test("kido jira pull materializes a Bug into a fresh repo", async () => {
  const { server, url } = await startFakeJira();
  const baRepo = makeRepo();
  const devRepo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);
    runNewChange(baRepo, "Fix Login Crash", "bug");
    const baChangeDir = resolveKidoPaths(baRepo).changeDir("fix-login-crash");
    writeFileSync(join(baChangeDir, "bug.md"), "# Login crashes on empty password\n\nRepro: submit empty password.");
    await runJiraSync(baRepo, "fix-login-crash");
    const bugKey = parseFrontmatter(readFileSync(join(baChangeDir, "bug.md"), "utf8")).frontmatter.jiraId as string;

    const devChangeName = await runJiraPull(devRepo, bugKey);
    assert.equal(devChangeName, "login-crashes-on-empty-password");

    const pulled = readFileSync(join(resolveKidoPaths(devRepo).changeDir(devChangeName), "bug.md"), "utf8");
    const { frontmatter, body } = parseFrontmatter(pulled);
    assert.equal(frontmatter.jiraId, bugKey);
    assert.match(body, /Repro: submit empty password\./);
  } finally {
    server.close();
    rmSync(baRepo, { recursive: true, force: true });
    rmSync(devRepo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("kido jira pull resolves a Story back to its parent Epic and materializes the whole change", async () => {
  const { server, url } = await startFakeJira();
  const baRepo = makeRepo();
  const devRepo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);
    runNewChange(baRepo, "Add Swap Pricing", "feature");
    const baChangeDir = resolveKidoPaths(baRepo).changeDir("add-swap-pricing");
    writeFileSync(join(baChangeDir, "functional-spec.md"), "# Swap Pricing\n\nBAs need to price swaps.");
    writeFileSync(
      join(baChangeDir, "tasks.md"),
      ["## Task 1: Add calculator", "", "Implement it.", "", "**Depends on:** none", "**Test:** unit test passes"].join("\n")
    );
    await runJiraSync(baRepo, "add-swap-pricing");
    const tasksContent = readFileSync(join(baChangeDir, "tasks.md"), "utf8");
    const storyKey = /\*\*Jira:\*\*\s*(\S+)/.exec(tasksContent)![1]!;

    const devChangeName = await runJiraPull(devRepo, storyKey);
    const devChangeDir = resolveKidoPaths(devRepo).changeDir(devChangeName);

    const spec = readFileSync(join(devChangeDir, "functional-spec.md"), "utf8");
    assert.match(parseFrontmatter(spec).body, /BAs need to price swaps\./);
    assert.ok(parseFrontmatter(spec).frontmatter.jiraId, "functional-spec.md should carry the Epic's key");

    const pulledTasks = parseTasks(readFileSync(join(devChangeDir, "tasks.md"), "utf8"));
    assert.equal(pulledTasks.length, 1);
    assert.equal(pulledTasks[0]!.title, "Add calculator");
    assert.match(pulledTasks[0]!.body, /Implement it\./);
    assert.match(pulledTasks[0]!.body, new RegExp(`\\*\\*Jira:\\*\\* ${storyKey}`));
  } finally {
    server.close();
    rmSync(baRepo, { recursive: true, force: true });
    rmSync(devRepo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("kido jira pull on an Epic reconstructs functional-spec.md + design.md + tasks.md (round trip)", async () => {
  const { server, url } = await startFakeJira();
  const baRepo = makeRepo();
  const devRepo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);
    runNewChange(baRepo, "Add Swap Pricing", "feature");
    const baChangeDir = resolveKidoPaths(baRepo).changeDir("add-swap-pricing");
    writeFileSync(join(baChangeDir, "functional-spec.md"), "# Swap Pricing\n\nBAs need to price swaps.");
    writeFileSync(join(baChangeDir, "design.md"), "# Swap Pricing\n\nUse a new pricing table.");
    writeFileSync(
      join(baChangeDir, "tasks.md"),
      [
        "## Task 1: Add calculator",
        "",
        "Implement it.",
        "",
        "**Depends on:** none",
        "**Test:** unit test passes",
        "",
        "## Task 2: Add validation",
        "",
        "Validate inputs.",
        "",
        "**Depends on:** Task 1",
        "**Test:** validation test passes",
      ].join("\n")
    );
    await runJiraSync(baRepo, "add-swap-pricing");
    const epicKey = parseFrontmatter(readFileSync(join(baChangeDir, "functional-spec.md"), "utf8")).frontmatter
      .jiraId as string;

    const devChangeName = await runJiraPull(devRepo, epicKey);
    const devChangeDir = resolveKidoPaths(devRepo).changeDir(devChangeName);

    assert.match(parseFrontmatter(readFileSync(join(devChangeDir, "functional-spec.md"), "utf8")).body, /BAs need to price swaps\./);
    assert.match(readFileSync(join(devChangeDir, "design.md"), "utf8"), /Use a new pricing table\./);

    const pulledTasks = parseTasks(readFileSync(join(devChangeDir, "tasks.md"), "utf8"));
    assert.deepEqual(
      pulledTasks.map((t) => t.title),
      ["Add calculator", "Add validation"]
    );
    assert.match(pulledTasks[1]!.body, /Validate inputs\./);
  } finally {
    server.close();
    rmSync(baRepo, { recursive: true, force: true });
    rmSync(devRepo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("kido jira pull materializes a small-feature Story directly, ignoring unrelated siblings under the same shared Epic", async () => {
  const { server, url, issues } = await startFakeJira();
  const baRepo = makeRepo();
  const devRepo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

    // A shared Epic BA already had, already collecting unrelated tickets.
    issues.set("SPREAD-9", { key: "SPREAD-9", fields: { summary: "Spreading", issuetype: { name: "Epic" } }, order: 0 });
    issues.set("SPREAD-10", {
      key: "SPREAD-10",
      fields: {
        summary: "Fix stale quote on reconnect",
        issuetype: { name: "Story" },
        parent: { key: "SPREAD-9" },
        description: { content: [{ content: [{ text: "Unrelated pre-existing ticket." }] }] },
      },
      order: 1,
    });

    runNewChange(baRepo, "Expose Currencies Endpoint", "feature");
    const baChangeDir = resolveKidoPaths(baRepo).changeDir("expose-currencies-endpoint");
    writeFileSync(
      join(baChangeDir, "functional-spec.md"),
      ["---", 'epicId: "SPREAD-9"', "---", "", "# Expose Currencies Endpoint", "", "Return all supported currencies."].join("\n")
    );
    await runJiraSync(baRepo, "expose-currencies-endpoint");
    const storyKey = parseFrontmatter(readFileSync(join(baChangeDir, "functional-spec.md"), "utf8")).frontmatter
      .jiraId as string;

    const devChangeName = await runJiraPull(devRepo, storyKey);
    const devChangeDir = resolveKidoPaths(devRepo).changeDir(devChangeName);

    const spec = readFileSync(join(devChangeDir, "functional-spec.md"), "utf8");
    assert.match(parseFrontmatter(spec).body, /Return all supported currencies\./);
    assert.equal(parseFrontmatter(spec).frontmatter.jiraId, storyKey);
    assert.equal(existsSync(join(devChangeDir, "design.md")), false, "no design.md was ever written for this feature");
    assert.equal(existsSync(join(devChangeDir, "tasks.md")), false, "small-feature mode never produces tasks.md");

    // The unrelated sibling under the same shared Epic must not leak in anywhere.
    assert.doesNotMatch(spec, /stale quote/);
  } finally {
    server.close();
    rmSync(baRepo, { recursive: true, force: true });
    rmSync(devRepo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("kido jira pull refuses a Story with no parent Epic", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);
    issues.set("TEST-1", {
      key: "TEST-1",
      fields: { summary: "Orphaned story", issuetype: { name: "Story" } },
      order: 0,
    });

    await assert.rejects(() => runJiraPull(repo, "TEST-1"), /no parent Epic/);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});
