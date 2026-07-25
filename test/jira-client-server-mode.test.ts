import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { JiraClient } from "../src/jira/client.js";
import type { JiraCredentials } from "../src/jira/credentials.js";

interface CapturedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

interface FakeServerState {
  requests: CapturedRequest[];
  issues: Map<string, { fields: Record<string, unknown> }>;
}

/** A small, purpose-built fake Jira Server/Data Center REST API (/rest/api/2) — enough of
 * POST/GET /issue(/:key) and POST /search to exercise JiraClient's server-mode branches
 * directly, without retrofitting the larger Cloud-oriented fakes in jira-sync.test.ts /
 * jira-pull.test.ts (see docs/superpowers/specs/2026-07-25-jira-server-data-center-support-design.md). */
function startFakeServerJira(): Promise<{ server: Server; url: string; state: FakeServerState }> {
  const state: FakeServerState = { requests: [], issues: new Map() };
  let nextId = 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "", "http://localhost");
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      state.requests.push({
        method: req.method ?? "",
        path: url.pathname,
        authorization: req.headers.authorization,
        body: parsedBody,
      });

      if (req.method === "POST" && url.pathname === "/rest/api/2/issue") {
        const key = `SRV-${nextId++}`;
        state.issues.set(key, { fields: (parsedBody as { fields: Record<string, unknown> }).fields });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const issueMatch = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && issueMatch) {
        const key = issueMatch[1]!;
        const issue = state.issues.get(key);
        if (!issue) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key, fields: issue.fields }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/rest/api/2/search") {
        const { startAt = 0 } = (parsedBody ?? {}) as { startAt?: number };
        const pageSize = 2; // force multi-page pagination regardless of requested maxResults
        const allIssues = [1, 2, 3, 4, 5].map((n) => ({
          key: `SRV-CHILD-${n}`,
          fields: { summary: `Child ${n}`, issuetype: { name: "Story" }, parent: { key: "SRV-EPIC" } },
        }));
        const page = allIssues.slice(startAt, startAt + pageSize);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issues: page, startAt, maxResults: pageSize, total: allIssues.length }));
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
      resolve({ server, url: `http://127.0.0.1:${port}`, state });
    });
  });
}

function serverCreds(baseUrl: string): JiraCredentials {
  return {
    baseUrl,
    apiToken: "fake-pat",
    projectKey: "SRV",
    deploymentType: "server",
  };
}

test("createIssue on Server/DC uses Bearer auth, /rest/api/2, and a wiki-markup (string) description body", async () => {
  const { server, url, state } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    const result = await client.createIssue({
      summary: "Test issue",
      description: "**bold** text",
      issueType: "Story",
    });

    assert.equal(result.key, "SRV-1");
    const createRequest = state.requests.find((r) => r.method === "POST" && r.path === "/rest/api/2/issue")!;
    assert.equal(createRequest.authorization, "Bearer fake-pat");
    const body = createRequest.body as { fields: { description: unknown } };
    assert.equal(
      typeof body.fields.description,
      "string",
      "Server/DC description must be a wiki-markup string, not an ADF doc object"
    );
    assert.equal(body.fields.description, "*bold* text");
  } finally {
    server.close();
  }
});

test("getIssue on Server/DC parses the description back from wiki markup to markdown", async () => {
  const { server, url } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    await client.createIssue({ summary: "Test issue", description: "line one", issueType: "Story" });

    const issue = await client.getIssue("SRV-1");
    assert.equal(issue.description, "line one");
  } finally {
    server.close();
  }
});

test("searchChildIssues on Server/DC paginates via POST /rest/api/2/search using startAt/maxResults", async () => {
  const { server, url, state } = await startFakeServerJira();
  try {
    const client = new JiraClient(serverCreds(url));
    const children = await client.searchChildIssues("SRV-EPIC");
    assert.deepEqual(
      children.map((c) => c.key),
      ["SRV-CHILD-1", "SRV-CHILD-2", "SRV-CHILD-3", "SRV-CHILD-4", "SRV-CHILD-5"]
    );
    const searchCalls = state.requests.filter((r) => r.method === "POST" && r.path === "/rest/api/2/search");
    assert.equal(searchCalls.length, 3, "expected 3 pages (2 + 2 + 1) via startAt/maxResults pagination");
  } finally {
    server.close();
  }
});
