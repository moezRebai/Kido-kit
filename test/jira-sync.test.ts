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
import { adfToMarkdown } from "../src/jira/adf.js";

/** A minimal fake Jira Cloud REST API — enough of /rest/api/3/issue(/:key), /transitions, and
 * attachments (upload/list/delete) to exercise JiraClient's create/update/attach paths without
 * real credentials. */
interface FakeAttachment {
  id: string;
  filename: string;
  buffer: Buffer;
}

interface FakeIssueFields {
  summary: string;
  issuetype: { name: string };
  parent?: { key: string };
  description?: unknown;
  attachments?: FakeAttachment[];
}

interface MultipartPart {
  name: string;
  filename?: string | undefined;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let start = body.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = body.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    const section = body.subarray(start + boundaryBuf.length, next);
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = section.subarray(0, headerEnd).toString("utf8");
      const nameMatch = /name="([^"]+)"/.exec(headerText);
      const filenameMatch = /filename="([^"]+)"/.exec(headerText);
      let data = section.subarray(headerEnd + 4);
      if (data.subarray(data.length - 2).toString("utf8") === "\r\n") data = data.subarray(0, data.length - 2);
      if (nameMatch) parts.push({ name: nameMatch[1]!, filename: filenameMatch?.[1], data });
    }
    start = next;
  }
  return parts;
}

function startFakeJira(): Promise<{ server: Server; url: string; issues: Map<string, FakeIssueFields>; nextId: { n: number } }> {
  const issues = new Map<string, FakeIssueFields>();
  const nextId = { n: 1 };
  let nextAttachmentId = 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] ?? "";
      const url = new URL(req.url ?? "", "http://localhost");

      if (req.method === "POST" && url.pathname === "/rest/api/3/issue") {
        const body = JSON.parse(rawBody.toString("utf8"));
        const key = `TEST-${nextId.n++}`;
        issues.set(key, body.fields);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const updateMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "PUT" && updateMatch) {
        const body = JSON.parse(rawBody.toString("utf8"));
        const key = updateMatch[1]!;
        issues.set(key, { ...(issues.get(key) as object), ...body.fields });
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && updateMatch) {
        const key = updateMatch[1]!;
        const issue = issues.get(key);
        if (!issue) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            key,
            fields: {
              summary: issue.summary,
              description: issue.description,
              issuetype: issue.issuetype,
              parent: issue.parent,
              attachment: (issue.attachments ?? []).map((a) => ({
                id: a.id,
                filename: a.filename,
                content: `http://fake-jira.invalid/attachment-content/${a.id}`,
              })),
            },
          })
        );
        return;
      }

      const attachMatch = /^\/rest\/api\/3\/issue\/([^/]+)\/attachments$/.exec(url.pathname);
      if (req.method === "POST" && attachMatch) {
        const key = attachMatch[1]!;
        const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(String(contentType));
        const boundary = boundaryMatch![1] ?? boundaryMatch![2]!;
        const filePart = parseMultipart(rawBody, boundary).find((p) => p.name === "file")!;
        const issue = issues.get(key)!;
        issue.attachments = issue.attachments ?? [];
        const id = `ATT-${nextAttachmentId++}`;
        issue.attachments.push({ id, filename: filePart.filename!, buffer: filePart.data });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id, filename: filePart.filename }]));
        return;
      }

      const deleteAttachMatch = /^\/rest\/api\/3\/attachment\/([^/]+)$/.exec(url.pathname);
      if (req.method === "DELETE" && deleteAttachMatch) {
        const id = deleteAttachMatch[1]!;
        for (const issue of issues.values()) {
          issue.attachments = (issue.attachments ?? []).filter((a) => a.id !== id);
        }
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

function setJiraEnv(url: string): void {
  process.env.KIDO_JIRA_BASE_URL = url;
  process.env.KIDO_JIRA_EMAIL = "test@example.com";
  process.env.KIDO_JIRA_API_TOKEN = "fake-token";
  process.env.KIDO_JIRA_PROJECT_KEY = "TEST";
}

test("jira sync creates an Epic from functional-spec.md and Stories from tasks.md, writing IDs back for idempotency", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

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
    assert.equal(issues.get("TEST-1")!.attachments?.[0]?.filename, "functional-spec.md");

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
    setJiraEnv(url);

    runNewChange(repo, "Fix Login Crash", "bug");
    const changeDir = resolveKidoPaths(repo).changeDir("fix-login-crash");
    writeFileSync(join(changeDir, "bug.md"), "# Login crashes on empty password\n\nRepro: submit empty password.");

    await runJiraSync(repo, "fix-login-crash");

    const bugContent = readFileSync(join(changeDir, "bug.md"), "utf8");
    const { frontmatter } = parseFrontmatter(bugContent);
    assert.equal(frontmatter.jiraId, "TEST-1");
    assert.equal(issues.get("TEST-1")!.issuetype.name, "Bug");
    assert.equal(issues.get("TEST-1")!.attachments, undefined, "bug.md stays inline, no attachment");
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
    setJiraEnv(url);

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

test("functional-spec.md with epicId frontmatter syncs as a Story under that Epic, not a new Epic", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

    // Simulate a shared Epic BA already had — not something Kido created.
    issues.set("SPREAD-9", { summary: "Spreading", issuetype: { name: "Epic" } });

    runNewChange(repo, "Expose Currencies Endpoint", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("expose-currencies-endpoint");
    writeFileSync(
      join(changeDir, "functional-spec.md"),
      ["---", 'epicId: "SPREAD-9"', "---", "", "# Expose Currencies Endpoint", "", "Return all supported currencies."].join("\n")
    );

    await runJiraSync(repo, "expose-currencies-endpoint");

    const specContent = readFileSync(join(changeDir, "functional-spec.md"), "utf8");
    const { frontmatter } = parseFrontmatter(specContent);
    const storyKey = frontmatter.jiraId as string;
    assert.ok(storyKey, "expected jiraId to be recorded");

    const story = issues.get(storyKey)!;
    assert.equal(story.issuetype.name, "Story", "should sync as a Story, not an Epic");
    assert.equal(story.parent!.key, "SPREAD-9");
    assert.match(adfToMarkdown(story.description), /^## Functional Spec/, "always prefixed, even without design.md");
    assert.equal(story.attachments?.[0]?.filename, "functional-spec.md");
    assert.equal(issues.size, 2, "only the pre-existing Epic plus this one new Story — no Epic created for it");

    // Re-syncing updates the same Story by jiraId, doesn't create a duplicate.
    await runJiraSync(repo, "expose-currencies-endpoint");
    assert.equal(issues.size, 2);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("re-syncing a feature with functional-spec.md + design.md doesn't duplicate attachments", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

    runNewChange(repo, "Add Swap Pricing", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("add-swap-pricing");
    writeFileSync(join(changeDir, "functional-spec.md"), "# Swap Pricing\n\nBAs need to price swaps.");
    await runJiraSync(repo, "add-swap-pricing");

    const epicKey = parseFrontmatter(readFileSync(join(changeDir, "functional-spec.md"), "utf8")).frontmatter
      .jiraId as string;
    assert.equal(issues.get(epicKey)!.attachments?.length, 1);

    // design.md gets added in a follow-up session, then re-synced.
    writeFileSync(join(changeDir, "design.md"), "# Swap Pricing\n\nUse a new pricing table.");
    await runJiraSync(repo, "add-swap-pricing");
    await runJiraSync(repo, "add-swap-pricing");

    const attachments = issues.get(epicKey)!.attachments ?? [];
    const specAttachments = attachments.filter((a) => a.filename === "functional-spec.md");
    const designAttachments = attachments.filter((a) => a.filename === "design.md");
    assert.equal(specAttachments.length, 1, "re-syncing must not duplicate the functional-spec.md attachment");
    assert.equal(designAttachments.length, 1, "re-syncing must not duplicate the design.md attachment");
    assert.match(designAttachments[0]!.buffer.toString("utf8"), /Use a new pricing table\./);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("syncing an Epic stores a short summary description and attaches the full files, not the whole body inline", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

    runNewChange(repo, "Currency Pair Spreads", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("currency-pair-spreads");
    writeFileSync(
      join(changeDir, "functional-spec.md"),
      [
        "# Currency Pair Spreads",
        "",
        "## 1. Overview & business problem",
        "",
        "This is the overview paragraph that should end up in the Jira summary.",
        "",
        "## 2. Users affected",
        "",
        "This body text must NOT appear in the Jira description — only in the attached file.",
      ].join("\n")
    );
    writeFileSync(join(changeDir, "design.md"), "# Currency Pair Spreads\n\nFull design content, attached only.");

    await runJiraSync(repo, "currency-pair-spreads");

    const epicKey = parseFrontmatter(readFileSync(join(changeDir, "functional-spec.md"), "utf8")).frontmatter
      .jiraId as string;
    const epic = issues.get(epicKey)!;
    const description = adfToMarkdown(epic.description);

    assert.match(description, /overview paragraph that should end up in the Jira summary/);
    assert.doesNotMatch(description, /must NOT appear in the Jira description/);
    assert.match(description, /attached to this ticket/);

    assert.equal(epic.attachments?.length, 2);
    const specAttachment = epic.attachments!.find((a) => a.filename === "functional-spec.md")!;
    const designAttachment = epic.attachments!.find((a) => a.filename === "design.md")!;
    assert.match(specAttachment.buffer.toString("utf8"), /must NOT appear in the Jira description/);
    assert.match(designAttachment.buffer.toString("utf8"), /Full design content, attached only\./);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("a tasks.md task with a bullet list, inline code, and bold labels gets real ADF nodes, not one literal-text paragraph", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };

  try {
    setJiraEnv(url);

    runNewChange(repo, "Add Swap Pricing", "feature");
    const changeDir = resolveKidoPaths(repo).changeDir("add-swap-pricing");
    writeFileSync(join(changeDir, "functional-spec.md"), "# Swap Pricing\n\nBAs need to price swaps.");
    writeFileSync(
      join(changeDir, "tasks.md"),
      [
        "## Task 1: Add calculator",
        "",
        "Implement `SwapCalculator` with:",
        "",
        "- Support for fixed legs",
        "- Support for floating legs",
        "",
        "**Depends on:** none",
        "**Test:** unit test passes",
      ].join("\n")
    );

    await runJiraSync(repo, "add-swap-pricing");

    const story = issues.get("TEST-2")!;
    const doc = story.description as { content: Array<{ type: string }> };
    assert.ok(doc.content.some((n) => n.type === "bulletList"), "expected a real bulletList node");
    const markdown = adfToMarkdown(story.description);
    assert.match(markdown, /`SwapCalculator`/);
    assert.match(markdown, /- Support for fixed legs/);
    assert.match(markdown, /\*\*Depends on:\*\*/);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});
