import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { JiraClient } from "../src/jira/client.js";
import type { JiraCredentials } from "../src/jira/credentials.js";

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

interface FakeServerState {
  requests: CapturedRequest[];
}

/** A small, purpose-built fake Jira Cloud REST API — POST/PUT /issue(/:key), plus
 * /project/:key/components and /priority (both cloud and server share these exact
 * standard-field endpoints, so this fake doesn't need to distinguish deployment type). */
function startFakeJira(): Promise<{ server: Server; url: string; state: FakeServerState }> {
  const state: FakeServerState = { requests: [] };
  let nextId = 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "", "http://localhost");
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      state.requests.push({ method: req.method ?? "", path: url.pathname, body: parsedBody });

      if (req.method === "GET" && url.pathname === "/rest/api/3/project/TEST/components") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ name: "payments-service" }, { name: "auth-service" }]));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/api/3/priority") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ name: "Highest" }, { name: "High" }, { name: "Medium" }, { name: "Low" }, { name: "Lowest" }]));
        return;
      }

      if (req.method === "POST" && url.pathname === "/rest/api/3/issue") {
        const key = `TEST-${nextId++}`;
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key }));
        return;
      }

      const updateMatch = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "PUT" && updateMatch) {
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
      resolve({ server, url: `http://127.0.0.1:${port}`, state });
    });
  });
}

function creds(baseUrl: string): JiraCredentials {
  return { baseUrl, email: "test@example.com", apiToken: "fake-token", projectKey: "TEST", deploymentType: "cloud" };
}

test("createIssue resolves a matching Component and Priority (case-insensitive) into the request fields", async () => {
  const { server, url, state } = await startFakeJira();
  try {
    const client = new JiraClient(creds(url));
    await client.createIssue({
      summary: "Add calculator",
      description: "body",
      issueType: "Story",
      component: "PAYMENTS-SERVICE",
      priority: "high",
    });

    const createRequest = state.requests.find((r) => r.method === "POST" && r.path === "/rest/api/3/issue")!;
    const body = createRequest.body as { fields: { components?: Array<{ name: string }>; priority?: { name: string } } };
    assert.deepEqual(body.fields.components, [{ name: "payments-service" }], "should use the project's actual casing, not the input's");
    assert.deepEqual(body.fields.priority, { name: "High" });
  } finally {
    server.close();
  }
});

test("createIssue warns and omits a Component/Priority that doesn't exist, but still creates the issue", async () => {
  const { server, url, state } = await startFakeJira();
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const client = new JiraClient(creds(url));
    const result = await client.createIssue({
      summary: "Add calculator",
      description: "body",
      issueType: "Story",
      component: "does-not-exist",
      priority: "Nonexistent",
    });

    assert.equal(result.key, "TEST-1", "issue must still be created despite unresolvable fields");
    const createRequest = state.requests.find((r) => r.method === "POST" && r.path === "/rest/api/3/issue")!;
    const body = createRequest.body as { fields: { components?: unknown; priority?: unknown } };
    assert.equal(body.fields.components, undefined);
    assert.equal(body.fields.priority, undefined);
    assert.ok(warnings.some((w) => w.includes("does-not-exist")), "should warn about the unresolvable component");
    assert.ok(warnings.some((w) => w.includes("Nonexistent")), "should warn about the unresolvable priority");
  } finally {
    console.warn = originalWarn;
    server.close();
  }
});

test("updateIssue also resolves Component/Priority", async () => {
  const { server, url, state } = await startFakeJira();
  try {
    const client = new JiraClient(creds(url));
    await client.updateIssue("TEST-1", { summary: "Add calculator", description: "body", priority: "Medium" });

    const updateRequest = state.requests.find((r) => r.method === "PUT" && r.path === "/rest/api/3/issue/TEST-1")!;
    const body = updateRequest.body as { fields: { priority?: { name: string } } };
    assert.deepEqual(body.fields.priority, { name: "Medium" });
  } finally {
    server.close();
  }
});

test("the project's components/priorities lists are fetched once and cached across multiple issue creations", async () => {
  const { server, url, state } = await startFakeJira();
  try {
    const client = new JiraClient(creds(url));
    await client.createIssue({ summary: "Task A", description: "body", issueType: "Story", component: "auth-service" });
    await client.createIssue({ summary: "Task B", description: "body", issueType: "Story", priority: "Low" });

    const componentsCalls = state.requests.filter((r) => r.path === "/rest/api/3/project/TEST/components");
    const prioritiesCalls = state.requests.filter((r) => r.path === "/rest/api/3/priority");
    assert.equal(componentsCalls.length, 1, "components list should only be fetched once, not per issue");
    assert.equal(prioritiesCalls.length, 1, "priorities list should only be fetched once, not per issue");
  } finally {
    server.close();
  }
});
