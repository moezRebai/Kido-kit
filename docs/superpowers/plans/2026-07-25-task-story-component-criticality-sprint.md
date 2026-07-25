# Task Story Component/Criticality/Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/kido:tasks` can optionally ask, per task, for a Jira Component/Criticality (Priority)/Sprint; `kido jira sync` sets these on the created (or updated, on re-sync) task Story, warning and skipping any value that doesn't resolve to something real in Jira rather than failing the whole sync.

**Architecture:** `JiraClient` gains resolution logic (cached lookups against Jira's REST + Agile REST APIs) so `createIssue`/`updateIssue` can turn a component/priority/sprint *name* into the right field value, or skip it with a warning. `jira-sync.ts` parses three new optional metadata lines out of each task's body (same pattern as the existing `**Jira:**` marker) and passes them through. `/kido:tasks`'s skill content gains instructions to ask for and write those lines. Epics, feature-Stories, and Bugs are untouched.

**Tech Stack:** TypeScript, Node.js built-ins only — no new dependencies. Same zero-runtime-dependency constraint as the rest of the project.

## Global Constraints

- Scope: task Stories only (`syncTasksAsStories` in `src/commands/jira-sync.ts`). Epics, feature-Stories, and `bug.md` are not touched.
- New optional `tasks.md` lines, in this exact form, appearing after `**Test:**`: `**Component:** <name>`, `**Criticality:** <name>`, `**Sprint:** <name>`. Any/all may be omitted; never write a placeholder line for an unanswered one.
- These lines stay in the Jira description text (same as `**Depends on:**`/`**Test:**` already do) — never stripped out.
- "Criticality" maps to Jira's standard `priority` field. "Component" maps to Jira's standard `components` field (single component, not a list). Both are validated against this Jira instance's real values before being sent — an unresolvable name warns (`console.warn`) and is omitted; it never fails the create/update.
- "Sprint" resolves via three cached lookups: the Sprint custom field's ID (`GET {apiBase}/field`, `schema.custom === "com.pyxis.greenhopper.jira:gh-sprint"`), the project's first Scrum board (`GET /rest/agile/1.0/board?projectKeyOrId=<projectKey>&type=scrum`), and that board's sprints (`GET /rest/agile/1.0/board/{boardId}/sprint`), matched by case-insensitive exact name. Any step failing to resolve warns and skips the Sprint field only. The Agile API base (`/rest/agile/1.0`) is separate from `{apiBase}` (`/rest/api/2` or `/rest/api/3`) and identical on Cloud and Server/DC — no `deploymentType` branching needed for it.
- Component/priority/field-ID/board-ID/board-sprints lookups are each cached once per `JiraClient` instance (not re-fetched per task within one sync run).
- `updateIssue` (re-sync) applies these fields too, not just `createIssue`.
- `JiraClient`'s existing public method signatures for `getIssue`, `searchChildIssues`, `attachFile`, `deleteAttachment`, `downloadAttachmentContent`, `transitionToStatus` are unchanged — this plan only touches `createIssue`/`updateIssue` and `JiraIssueInput`.
- `tsconfig.json` has `exactOptionalPropertyTypes: true`. Any new optional interface field that will ever be assigned a `string | undefined` variable (not just a literal string) must be typed `field?: string | undefined`, not `field?: string` — the latter compiles fine until something actually passes it an explicit `undefined`, which is exactly what happens here (`jira-sync.ts`'s regex captures are `string | undefined`). Every task below that adds such a field already accounts for this; `npm run typecheck` (not `npm test`, which never runs the type checker) is the only way to catch a regression.

---

### Task 1: Component and Criticality resolution in `JiraClient`

**Files:**
- Modify: `src/jira/client.ts`
- Create: `test/jira-client-component-priority.test.ts`

**Interfaces:**
- Produces: `JiraIssueInput` gains `component?: string` and `priority?: string`. `updateIssue`'s parameter type widens from `Pick<JiraIssueInput, "summary" | "description">` to `Pick<JiraIssueInput, "summary" | "description" | "component" | "priority">`. Both `createIssue` and `updateIssue` resolve these against the project's real components/priorities before sending, via a new private `resolveOptionalFields` method — Task 2 extends this same method to also handle `sprintName`.

- [ ] **Step 1: Write the failing tests**

Create `test/jira-client-component-priority.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/jira-client-component-priority.test.js`
Expected: FAIL — `component`/`priority` aren't recognized fields on `JiraIssueInput` yet (or, since TS allows excess properties to be silently accepted structurally in some contexts, at minimum the requests never hit `/components`/`/priority` and the sent `fields` never include `components`/`priority`).

- [ ] **Step 3: Modify `src/jira/client.ts`**

Change the `JiraIssueInput` interface:

```ts
export interface JiraIssueInput {
  summary: string;
  description: string;
  issueType: JiraIssueType;
  /** Epic key to nest a Story under (Jira's "parent" field for team-managed projects). */
  parentKey?: string;
  /** Matched case-insensitively against the project's real components; unresolvable = warn + omit.
   * Typed `| undefined` (not just optional) because tsconfig has `exactOptionalPropertyTypes: true`,
   * and callers (Task 4) pass through a regex capture that's `string | undefined`, not always-present. */
  component?: string | undefined;
  /** Maps to Jira's standard Priority field ("Criticality" in kido's task template); same resolution rule as component. */
  priority?: string | undefined;
}
```

Add two private cache fields and a resolution method to the `JiraClient` class — insert them right after the `apiBase`/`isServer` fields and before `authHeader()`:

```ts
  private componentsCache?: Promise<Map<string, string>>;
  private prioritiesCache?: Promise<Map<string, string>>;

  private async getProjectComponents(): Promise<Map<string, string>> {
    if (!this.componentsCache) {
      this.componentsCache = (async () => {
        const response = await this.request(`${this.apiBase}/project/${this.creds.projectKey}/components`, { method: "GET" });
        const data = (await response.json()) as Array<{ name: string }>;
        return new Map(data.map((c) => [c.name.toLowerCase(), c.name]));
      })();
    }
    return this.componentsCache;
  }

  private async getPriorities(): Promise<Map<string, string>> {
    if (!this.prioritiesCache) {
      this.prioritiesCache = (async () => {
        const response = await this.request(`${this.apiBase}/priority`, { method: "GET" });
        const data = (await response.json()) as Array<{ name: string }>;
        return new Map(data.map((p) => [p.name.toLowerCase(), p.name]));
      })();
    }
    return this.prioritiesCache;
  }

  /** Resolves component/priority (and, from Task 2 onward, sprintName) names into real Jira
   * field values, warning and omitting anything that doesn't exist rather than failing the
   * whole create/update — Jira's issue write is atomic, so an invalid value inline would fail
   * every field, not just the bad one. `label` is the issue's own summary, used in warnings. */
  private async resolveOptionalFields(
    input: { component?: string | undefined; priority?: string | undefined },
    label: string
  ): Promise<Record<string, unknown>> {
    const fields: Record<string, unknown> = {};
    if (input.component) {
      const components = await this.getProjectComponents();
      const matched = components.get(input.component.toLowerCase());
      if (matched) fields.components = [{ name: matched }];
      else console.warn(`Warning: "${label}": Component "${input.component}" not found on this project — skipping.`);
    }
    if (input.priority) {
      const priorities = await this.getPriorities();
      const matched = priorities.get(input.priority.toLowerCase());
      if (matched) fields.priority = { name: matched };
      else console.warn(`Warning: "${label}": Priority "${input.priority}" not found on this Jira instance — skipping.`);
    }
    return fields;
  }
```

Change `createIssue` to merge in the resolved fields:

```ts
  async createIssue(input: JiraIssueInput): Promise<JiraIssueResult> {
    const fields: Record<string, unknown> = {
      project: { key: this.creds.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType },
      description: this.formatBody(input.description),
    };
    if (input.parentKey) {
      fields.parent = { key: input.parentKey };
    }
    Object.assign(fields, await this.resolveOptionalFields(input, input.summary));

    const response = await this.request(`${this.apiBase}/issue`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    const data = (await response.json()) as { key: string };
    return { key: data.key, url: `${this.creds.baseUrl}/browse/${data.key}` };
  }
```

Change `updateIssue`'s signature and body:

```ts
  async updateIssue(
    key: string,
    input: Pick<JiraIssueInput, "summary" | "description" | "component" | "priority">
  ): Promise<void> {
    const fields: Record<string, unknown> = {
      summary: input.summary,
      description: this.formatBody(input.description),
    };
    Object.assign(fields, await this.resolveOptionalFields(input, input.summary));
    await this.request(`${this.apiBase}/issue/${key}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/jira-client-component-priority.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, all tests — critically, the existing `test/jira-sync.test.ts` and `test/jira-pull.test.ts` suites must still pass unchanged, since they never set `component`/`priority`, so `resolveOptionalFields` returns `{}` for them and nothing about the request body changes.

Run: `npm run typecheck`
Expected: no errors mentioning `client.ts` or `JiraIssueInput`. (This project has `exactOptionalPropertyTypes: true` in `tsconfig.json` — a past task in an earlier plan introduced a typecheck error by declaring an optional field as `foo?: string` while assigning it a `string | undefined` value; this step exists specifically to catch that class of bug before it's committed, since `npm run build`/`npm test` don't run the type checker at all.)

- [ ] **Step 6: Commit**

```bash
git add src/jira/client.ts test/jira-client-component-priority.test.ts
git commit -m "Resolve Component and Priority (Criticality) fields in JiraClient"
```

---

### Task 2: Sprint resolution in `JiraClient`

**Files:**
- Modify: `src/jira/client.ts`
- Create: `test/jira-client-sprint.test.ts`

**Interfaces:**
- Consumes: `resolveOptionalFields` from Task 1 (extends it to also handle `sprintName`).
- Produces: `JiraIssueInput` gains `sprintName?: string`. `updateIssue`'s `Pick` widens to also include `"sprintName"`.

- [ ] **Step 1: Write the failing tests**

Create `test/jira-client-sprint.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/jira-client-sprint.test.js`
Expected: FAIL — `sprintName` isn't recognized/resolved yet, so `fields["customfield_10007"]` is never set and none of the `/field`/`/rest/agile/1.0/board*` routes are ever requested.

- [ ] **Step 3: Modify `src/jira/client.ts`**

Add `sprintName` to `JiraIssueInput`:

```ts
export interface JiraIssueInput {
  summary: string;
  description: string;
  issueType: JiraIssueType;
  /** Epic key to nest a Story under (Jira's "parent" field for team-managed projects). */
  parentKey?: string;
  /** Matched case-insensitively against the project's real components; unresolvable = warn + omit.
   * Typed `| undefined` (not just optional) because tsconfig has `exactOptionalPropertyTypes: true`,
   * and callers (Task 4) pass through a regex capture that's `string | undefined`, not always-present. */
  component?: string | undefined;
  /** Maps to Jira's standard Priority field ("Criticality" in kido's task template); same resolution rule as component. */
  priority?: string | undefined;
  /** Matched case-insensitively against the project's Scrum board's sprints; unresolvable = warn + omit. */
  sprintName?: string | undefined;
}
```

Add the Agile API base constant near the top of the file, right after `API_BASE`:

```ts
// Jira Software's Agile REST API — versioned independently of /rest/api/{2,3} and identical
// on Cloud and Server/Data Center, so it needs no deploymentType branching.
const AGILE_API_BASE = "/rest/agile/1.0";
```

Add three more cache fields alongside `componentsCache`/`prioritiesCache`:

```ts
  private sprintFieldIdCache?: Promise<string | undefined>;
  private scrumBoardIdCache?: Promise<number | undefined>;
  private boardSprintsCache?: Promise<Array<{ id: number; name: string }>>;
```

Add three resolution methods, right after `getPriorities()`:

```ts
  private async findSprintFieldId(): Promise<string | undefined> {
    if (!this.sprintFieldIdCache) {
      this.sprintFieldIdCache = (async () => {
        const response = await this.request(`${this.apiBase}/field`, { method: "GET" });
        const fields = (await response.json()) as Array<{ id: string; schema?: { custom?: string } }>;
        return fields.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint")?.id;
      })();
    }
    return this.sprintFieldIdCache;
  }

  private async findScrumBoardId(): Promise<number | undefined> {
    if (!this.scrumBoardIdCache) {
      this.scrumBoardIdCache = (async () => {
        const response = await this.request(
          `${AGILE_API_BASE}/board?projectKeyOrId=${encodeURIComponent(this.creds.projectKey)}&type=scrum`,
          { method: "GET" }
        );
        const data = (await response.json()) as { values: Array<{ id: number }> };
        return data.values[0]?.id;
      })();
    }
    return this.scrumBoardIdCache;
  }

  private async getBoardSprints(boardId: number): Promise<Array<{ id: number; name: string }>> {
    if (!this.boardSprintsCache) {
      this.boardSprintsCache = (async () => {
        const response = await this.request(`${AGILE_API_BASE}/board/${boardId}/sprint`, { method: "GET" });
        const data = (await response.json()) as { values: Array<{ id: number; name: string }> };
        return data.values;
      })();
    }
    return this.boardSprintsCache;
  }

  private async resolveSprintId(sprintName: string): Promise<number | undefined> {
    const boardId = await this.findScrumBoardId();
    if (boardId === undefined) return undefined;
    const sprints = await this.getBoardSprints(boardId);
    return sprints.find((s) => s.name.toLowerCase() === sprintName.toLowerCase())?.id;
  }
```

Replace `resolveOptionalFields` (from Task 1) with this extended version, adding the `sprintName` branch and widening its parameter type:

```ts
  private async resolveOptionalFields(
    input: { component?: string | undefined; priority?: string | undefined; sprintName?: string | undefined },
    label: string
  ): Promise<Record<string, unknown>> {
    const fields: Record<string, unknown> = {};
    if (input.component) {
      const components = await this.getProjectComponents();
      const matched = components.get(input.component.toLowerCase());
      if (matched) fields.components = [{ name: matched }];
      else console.warn(`Warning: "${label}": Component "${input.component}" not found on this project — skipping.`);
    }
    if (input.priority) {
      const priorities = await this.getPriorities();
      const matched = priorities.get(input.priority.toLowerCase());
      if (matched) fields.priority = { name: matched };
      else console.warn(`Warning: "${label}": Priority "${input.priority}" not found on this Jira instance — skipping.`);
    }
    if (input.sprintName) {
      const sprintFieldId = await this.findSprintFieldId();
      if (!sprintFieldId) {
        console.warn(`Warning: "${label}": no Sprint field found on this Jira instance — skipping Sprint "${input.sprintName}".`);
      } else {
        const sprintId = await this.resolveSprintId(input.sprintName);
        if (sprintId === undefined) {
          console.warn(`Warning: "${label}": Sprint "${input.sprintName}" not found on the project's board — skipping.`);
        } else {
          fields[sprintFieldId] = sprintId;
        }
      }
    }
    return fields;
  }
```

Finally, widen `updateIssue`'s parameter type to include `sprintName`:

```ts
  async updateIssue(
    key: string,
    input: Pick<JiraIssueInput, "summary" | "description" | "component" | "priority" | "sprintName">
  ): Promise<void> {
```

(The body of `updateIssue` from Task 1 is unchanged — it already calls `resolveOptionalFields(input, input.summary)`, which now also handles `sprintName` since the method itself was extended above.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/jira-client-sprint.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, all tests, including Task 1's `test/jira-client-component-priority.test.ts` (component/priority resolution must be unaffected by the sprint additions) and the existing Cloud/Server-mode Jira suites.

Run: `npm run typecheck`
Expected: no errors mentioning `client.ts` or `JiraIssueInput`.

- [ ] **Step 6: Commit**

```bash
git add src/jira/client.ts test/jira-client-sprint.test.ts
git commit -m "Resolve Sprint field in JiraClient via Jira Software's Agile REST API"
```

---

### Task 3: `/kido:tasks` template gains optional Component/Criticality/Sprint lines

**Files:**
- Modify: `src/skills-content/tasks.ts`

**Interfaces:** None — this is prompt content for an LLM-driven skill, not code with a function signature. Task 4 depends on the exact line format (`**Component:** <value>`, `**Criticality:** <value>`, `**Sprint:** <value>`) matching what it parses.

No test file — this file has no existing test coverage (it's instructional prompt text, like the rest of `src/skills-content/`), and this task doesn't change that.

**Important:** `src/skills-content/tasks.ts`'s `body` constant is a JS template literal (backtick-delimited), so every literal backtick inside the instructional text is already escaped in the source as `` \` `` (backslash-backtick), and every literal triple-backtick code fence is `` \`\`\` ``. The "Find"/"Replace" blocks below show the EXACT raw source text, escapes included — copy them verbatim, don't "clean up" the backslashes.

- [ ] **Step 1: Update the "For each task, capture" list**

In `src/skills-content/tasks.ts`, find this exact text (raw source, escapes included):

```
For each task, capture:
- Description (what it does, framed as a demonstrable slice)
- Likely-touched files/areas
- Acceptance check — ideally a specific test that should pass once it's done (TDD convention)
- Dependencies on other tasks (for \`/kido:apply\`'s sequential-vs-parallel dispatch)
```

Replace it with:

```
For each task, capture:
- Description (what it does, framed as a demonstrable slice)
- Likely-touched files/areas
- Acceptance check — ideally a specific test that should pass once it's done (TDD convention)
- Dependencies on other tasks (for \`/kido:apply\`'s sequential-vs-parallel dispatch)
- Optionally, ask whether this task should carry a Jira Component, Criticality (Jira's Priority field), or Sprint — skip any the BA doesn't have an answer for, don't force it or invent a value
```

- [ ] **Step 2: Update the Format section's example block**

Find this exact text (raw source, escapes included):

```
## Format (required — the CLI parses this to sync each task as a Jira Story)

Write each task as its own \`##\` heading, in this exact shape, so \`kido jira sync\` can extract them reliably:

\`\`\`
## Task 1: <short title>

<description of the vertical slice>

**Depends on:** none | Task <n>[, Task <m>...]
**Test:** <the acceptance check / test that should pass>
\`\`\`
```

Replace it with:

```
## Format (required — the CLI parses this to sync each task as a Jira Story)

Write each task as its own \`##\` heading, in this exact shape, so \`kido jira sync\` can extract them reliably:

\`\`\`
## Task 1: <short title>

<description of the vertical slice>

**Depends on:** none | Task <n>[, Task <m>...]
**Test:** <the acceptance check / test that should pass>
**Component:** <Jira component name, only if the BA gave one>
**Criticality:** <Jira priority name, only if the BA gave one>
**Sprint:** <Jira sprint name, only if the BA gave one>
\`\`\`

The last three lines are optional — omit any the BA didn't answer, never write a placeholder like "**Component:** (none)".
```

- [ ] **Step 3: Run the full suite (sanity check — this file isn't executed, but confirms nothing else broke)**

Run: `npm test`
Expected: PASS, all tests, unchanged count from before this task.

- [ ] **Step 4: Commit**

```bash
git add src/skills-content/tasks.ts
git commit -m "Ask about Component/Criticality/Sprint per task in /kido:tasks"
```

---

### Task 4: Wire Component/Criticality/Sprint parsing into `kido jira sync`

**Files:**
- Modify: `src/commands/jira-sync.ts`
- Modify: `test/jira-sync.test.ts`

**Interfaces:**
- Consumes: `JiraIssueInput.component`/`.priority`/`.sprintName` and `updateIssue`'s widened `Pick` type (Tasks 1-2). The exact `**Component:**`/`**Criticality:**`/`**Sprint:**` line format (Task 3).

- [ ] **Step 1: Write the failing tests**

In `test/jira-sync.test.ts`, first add three new route handlers to `startFakeJira()`'s request handler — insert them right before the final `res.writeHead(404); res.end();` fallback (currently at the end of the handler, after the `deleteAttachMatch` block):

```ts
      if (req.method === "GET" && url.pathname === "/rest/api/3/project/TEST/components") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ name: "payments-service" }]));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/api/3/priority") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ name: "Highest" }, { name: "High" }, { name: "Medium" }, { name: "Low" }, { name: "Lowest" }]));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/api/3/field") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: "customfield_10007", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } }]));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/agile/1.0/board") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ values: [{ id: 5, type: "scrum" }] }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/rest/agile/1.0/board/5/sprint") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ values: [{ id: 42, name: "Sprint 42" }] }));
        return;
      }
```

Then append these three new tests at the end of `test/jira-sync.test.ts` (after the last existing `test(...)` block):

```ts
test("a task's Component/Criticality/Sprint lines resolve into real Jira fields on the created Story", async () => {
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
        "**Component:** payments-service",
        "**Criticality:** High",
        "**Sprint:** Sprint 42",
      ].join("\n")
    );

    await runJiraSync(repo, "add-swap-pricing");

    const story = issues.get("TEST-2") as unknown as { fields: { components?: Array<{ name: string }>; priority?: { name: string }; [key: string]: unknown } };
    assert.deepEqual(story.fields.components, [{ name: "payments-service" }]);
    assert.deepEqual(story.fields.priority, { name: "High" });
    assert.equal(story.fields["customfield_10007"], 42);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("an unresolvable Component warns but still creates the Story with everything else intact", async () => {
  const { server, url, issues } = await startFakeJira();
  const repo = makeRepo();
  const originalEnv = { ...process.env };
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

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
        "**Component:** does-not-exist",
      ].join("\n")
    );

    await runJiraSync(repo, "add-swap-pricing");

    const story = issues.get("TEST-2") as unknown as { summary: string; fields?: { components?: unknown } };
    assert.equal(story.summary, "Add calculator", "Story must still be created");
    assert.ok(warnings.some((w) => w.includes("does-not-exist")));
  } finally {
    console.warn = originalWarn;
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});

test("re-syncing a task with a changed Criticality line updates the Story's priority", async () => {
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
      ["## Task 1: Add calculator", "", "Implement it.", "", "**Depends on:** none", "**Test:** unit test passes", "**Criticality:** Low"].join("\n")
    );
    await runJiraSync(repo, "add-swap-pricing");

    const tasksContent = readFileSync(join(changeDir, "tasks.md"), "utf8");
    const updated = tasksContent.replace("**Criticality:** Low", "**Criticality:** High");
    writeFileSync(join(changeDir, "tasks.md"), updated);

    await runJiraSync(repo, "add-swap-pricing");

    const story = issues.get("TEST-2") as unknown as { fields: { priority?: { name: string } } };
    assert.deepEqual(story.fields.priority, { name: "High" });
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    process.env = originalEnv;
  }
});
```

Note: these tests read `issues.get("TEST-2")!.fields` directly (the fake server's in-memory `FakeIssueFields`, which already stores whatever `fields` object the client sent) — no fake-server changes are needed to *store* `components`/`priority`/`customfield_10007`, since the existing POST/PUT handlers already do `issues.set(key, body.fields)` / `{ ...existing.fields, ...body.fields }` for any fields present, not just the ones explicitly typed in `FakeIssueFields`. `FakeIssueFields`'s TypeScript interface doesn't declare `components`/`priority`/`customfield_10007`, which is why the test casts through `unknown` — this is intentional and matches how the fake stores arbitrary fields already.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/jira-sync.test.js`
Expected: FAIL on the three new tests — `syncTasksAsStories` doesn't parse `**Component:**`/`**Criticality:**`/`**Sprint:**` yet, so the fields are never sent and the fake server's new routes are never hit.

- [ ] **Step 3: Modify `src/commands/jira-sync.ts`**

Add three new line-regexes right after the existing `JIRA_LINE` constant:

```ts
const JIRA_LINE = /^\*\*Jira:\*\*\s*(\S+)\s*$/m;
const COMPONENT_LINE = /^\*\*Component:\*\*\s*(.+)$/m;
const CRITICALITY_LINE = /^\*\*Criticality:\*\*\s*(.+)$/m;
const SPRINT_LINE = /^\*\*Sprint:\*\*\s*(.+)$/m;
```

Replace `syncTasksAsStories`'s body (keep its signature unchanged) with:

```ts
async function syncTasksAsStories(client: JiraClient, tasksPath: string, epicKey: string | undefined): Promise<void> {
  let content = readFileSync(tasksPath, "utf8");
  const tasks = parseTasks(content);

  for (const task of tasks) {
    const component = COMPONENT_LINE.exec(task.body)?.[1]?.trim();
    const priority = CRITICALITY_LINE.exec(task.body)?.[1]?.trim();
    const sprintName = SPRINT_LINE.exec(task.body)?.[1]?.trim();

    const existingMatch = JIRA_LINE.exec(task.body);
    if (existingMatch) {
      const key = existingMatch[1]!;
      await client.updateIssue(key, { summary: task.title, description: task.body, component, priority, sprintName });
      console.log(`Updated Story ${key}: ${task.title}`);
      continue;
    }

    const result = await client.createIssue({
      summary: task.title,
      description: task.body,
      issueType: "Story",
      ...(epicKey ? { parentKey: epicKey } : {}),
      component,
      priority,
      sprintName,
    });
    console.log(`Created Story ${result.key}: ${task.title} (${result.url})`);

    // Insert a **Jira:** marker right after this task's heading so re-syncing is idempotent.
    const headingPattern = new RegExp(`(##\\s+Task\\s+\\d+:\\s*${escapeRegExp(task.title)}\\s*\\n)`);
    content = content.replace(headingPattern, `$1\n**Jira:** ${result.key}\n`);
  }

  writeFileSync(tasksPath, content, "utf8");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test dist/test/jira-sync.test.js`
Expected: PASS, all tests in this file (the 3 new ones plus every pre-existing one — none of the pre-existing `tasks.md` fixtures in this file include Component/Criticality/Sprint lines, so `component`/`priority`/`sprintName` are `undefined` for them and `resolveOptionalFields` returns `{}`, changing nothing about their requests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: no errors mentioning `jira-sync.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/commands/jira-sync.ts test/jira-sync.test.ts
git commit -m "Parse and sync Component/Criticality/Sprint from tasks.md task Stories"
```

---

### Task 5: Documentation

**Files:**
- Modify: `DESIGN.md`

No interfaces, no tests — prose only, sequenced last so it accurately describes the finished feature.

- [ ] **Step 1: Update `DESIGN.md`**

Find the `kido jira sync` row in the CLI subcommands table (currently reads, in relevant part):

```
| `kido jira sync --change <name> [--epic <KEY>]` | Pushes `functional-spec.md`/`design.md` (Epic or feature-Story), `tasks.md` (Task Stories), and `bug.md` (Bug) content to Jira; stores returned IDs back into frontmatter; idempotent (create-or-update by stored ID). For an Epic/feature-Story, the description is a short auto-extracted summary (the body up to the first `##` subsection, plus a note) — the full `functional-spec.md`/`design.md` files are uploaded as real Jira attachments instead of embedded inline, deleting-then-reuploading on re-sync so nothing duplicates. Task-Story/Bug descriptions stay fully inline, now encoded as real ADF (headings/lists/bold/inline-code/code-blocks) instead of one plain-text paragraph. `--epic` pins Stories to an existing Epic, overriding whatever `functional-spec.md` would auto-create — needed for Dev-only changes (no `functional-spec.md`) or attaching to an Epic that predates Kido adoption. |
```

Append one sentence to the end of that cell's text (immediately before the closing ` |`):

```
 A task Story can optionally carry a Component, Criticality (Jira's Priority field), and/or Sprint — set via `**Component:**`/`**Criticality:**`/`**Sprint:**` lines in `tasks.md` (asked for, not forced, during `/kido:tasks`); an unresolvable value warns and is skipped rather than failing the sync, and Sprint resolves through Jira Software's Agile REST API (a project's first Scrum board), independent of Cloud vs Server/Data Center.
```

- [ ] **Step 2: Verify the full suite still passes (docs-only change, but confirms nothing else was left uncommitted)**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "Document Component/Criticality/Sprint support for task Stories"
```
