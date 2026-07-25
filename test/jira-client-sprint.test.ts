import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { JiraClient } from "../src/jira/client.js";
import type { JiraCredentials } from "../src/jira/credentials.js";

interface CapturedRequest {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

interface FakeServerState {
  requests: CapturedRequest[];
}

const SPRINT_FIELDS = [
  { id: "customfield_10000", name: "Story Points", schema: { custom: "com.atlassian.jira.plugin.system.customfieldtypes:float" } },
  { id: "customfield_10007", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
];

/** A small, purpose-built fake Jira REST + Agile API — POST /issue, GET /field,
 * GET /rest/agile/1.0/board, GET /rest/agile/1.0/board/:id/sprint. The Agile API base is
 * identical on Cloud and Server/DC (versioned independently of /rest/api/{2,3}), so this
 * fake doesn't need to distinguish deployment type either. */
function startFakeJira(hasSprintField = true): Promise<{ server: Server; url: string; state: FakeServerState }> {
  const state: FakeServerState = { requests: [] };
  let nextId = 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "", "http://localhost");
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      state.requests.push({ method: req.method ?? "", path: url.pathname, query: url.search, body: parsedBody });

      if (req.method === "GET" && url.pathname === "/rest/api/3/field") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(hasSprintField ? SPRINT_FIELDS : [SPRINT_FIELDS[0]]));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/agile/1.0/board") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ values: [{ id: 5, type: "scrum" }] }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/agile/1.0/board/5/sprint") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ values: [{ id: 42, name: "Sprint 42" }, { id: 43, name: "Sprint 43" }] }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/rest/api/3/issue") {
        const key = `TEST-${nextId++}`;
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
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

function creds(baseUrl: string): JiraCredentials {
  return { baseUrl, email: "test@example.com", apiToken: "fake-token", projectKey: "TEST", deploymentType: "cloud" };
}

test("createIssue resolves a Sprint name (case-insensitive) to the Sprint custom field's ID and the matching sprint's ID", async () => {
  const { server, url, state } = await startFakeJira();
  try {
    const client = new JiraClient(creds(url));
    await client.createIssue({ summary: "Add calculator", description: "body", issueType: "Story", sprintName: "sprint 42" });

    const createRequest = state.requests.find((r) => r.method === "POST" && r.path === "/rest/api/3/issue")!;
    const body = createRequest.body as { fields: Record<string, unknown> };
    assert.equal(body.fields["customfield_10007"], 42);
  } finally {
    server.close();
  }
});

test("createIssue warns and omits Sprint when the name doesn't match any sprint on the board", async () => {
  const { server, url } = await startFakeJira();
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const client = new JiraClient(creds(url));
    const result = await client.createIssue({ summary: "Add calculator", description: "body", issueType: "Story", sprintName: "Sprnt 999" });
    assert.equal(result.key, "TEST-1", "issue must still be created");
    assert.ok(warnings.some((w) => w.includes("Sprnt 999")));
  } finally {
    console.warn = originalWarn;
    server.close();
  }
});

test("createIssue warns and omits Sprint when this Jira instance has no Sprint field at all", async () => {
  const { server, url } = await startFakeJira(false);
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const client = new JiraClient(creds(url));
    const result = await client.createIssue({ summary: "Add calculator", description: "body", issueType: "Story", sprintName: "Sprint 42" });
    assert.equal(result.key, "TEST-1");
    assert.ok(warnings.some((w) => w.length > 0));
  } finally {
    console.warn = originalWarn;
    server.close();
  }
});

test("the field/board/sprint lookups are each fetched once and cached across multiple issue creations", async () => {
  const { server, url, state } = await startFakeJira();
  try {
    const client = new JiraClient(creds(url));
    await client.createIssue({ summary: "Task A", description: "body", issueType: "Story", sprintName: "Sprint 42" });
    await client.createIssue({ summary: "Task B", description: "body", issueType: "Story", sprintName: "Sprint 43" });

    assert.equal(state.requests.filter((r) => r.path === "/rest/api/3/field").length, 1);
    assert.equal(state.requests.filter((r) => r.path === "/rest/agile/1.0/board").length, 1);
    assert.equal(state.requests.filter((r) => r.path === "/rest/agile/1.0/board/5/sprint").length, 1);
  } finally {
    server.close();
  }
});
