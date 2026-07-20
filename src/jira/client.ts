import type { JiraCredentials } from "./credentials.js";

export type JiraIssueType = "Epic" | "Story" | "Bug";

export interface JiraIssueInput {
  summary: string;
  description: string;
  issueType: JiraIssueType;
  /** Epic key to nest a Story under (Jira's "parent" field for team-managed projects). */
  parentKey?: string;
}

export interface JiraIssueResult {
  key: string;
  url: string;
}

export interface JiraIssueDetails {
  key: string;
  summary: string;
  description: string;
  issueType: JiraIssueType;
  parentKey?: string;
}

/** ADF description -> plain text, best effort. The encoder always writes a single
 * paragraph/single text node (see createIssue/updateIssue below), so this round-trips
 * that exactly; content added via Jira's own rich-text editor may not fully survive. */
function adfDescriptionToText(description: unknown): string {
  const doc = description as { content?: unknown[] } | undefined;
  if (!doc?.content) return "";
  return doc.content.map(collectText).join("\n\n");
}

function collectText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (Array.isArray(n.content)) return n.content.map(collectText).join("");
  return "";
}

/** Thin fetch-based Jira Cloud REST client — no SDK dependency (decision #13). */
export class JiraClient {
  constructor(private readonly creds: JiraCredentials) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.creds.email}:${this.creds.apiToken}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.creds.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }
    return response;
  }

  /** Creates a new issue. Idempotency (create-or-update by stored key) is the caller's job — see jira-sync.ts. */
  async createIssue(input: JiraIssueInput): Promise<JiraIssueResult> {
    const fields: Record<string, unknown> = {
      project: { key: this.creds.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType },
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }],
      },
    };
    if (input.parentKey) {
      fields.parent = { key: input.parentKey };
    }

    const response = await this.request("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    const data = (await response.json()) as { key: string };
    return { key: data.key, url: `${this.creds.baseUrl}/browse/${data.key}` };
  }

  async updateIssue(key: string, input: Pick<JiraIssueInput, "summary" | "description">): Promise<void> {
    await this.request(`/rest/api/3/issue/${key}`, {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          summary: input.summary,
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }],
          },
        },
      }),
    });
  }

  /** Reads a single issue back — the reverse of createIssue/updateIssue, used by `kido jira pull`. */
  async getIssue(key: string): Promise<JiraIssueDetails> {
    const response = await this.request(
      `/rest/api/3/issue/${key}?fields=summary,description,issuetype,parent`,
      { method: "GET" }
    );
    const data = (await response.json()) as {
      key: string;
      fields: {
        summary: string;
        description?: unknown;
        issuetype: { name: string };
        parent?: { key: string };
      };
    };
    return {
      key: data.key,
      summary: data.fields.summary,
      description: adfDescriptionToText(data.fields.description),
      issueType: data.fields.issuetype.name as JiraIssueType,
      parentKey: data.fields.parent?.key,
    };
  }

  /** Lists Stories nested under an Epic, oldest first — used to reconstruct tasks.md on pull. */
  async searchChildIssues(epicKey: string): Promise<JiraIssueDetails[]> {
    const jql = encodeURIComponent(`parent = ${epicKey} ORDER BY created ASC`);
    const response = await this.request(
      `/rest/api/3/search?jql=${jql}&fields=summary,description,issuetype,parent`,
      { method: "GET" }
    );
    const data = (await response.json()) as {
      issues: Array<{
        key: string;
        fields: { summary: string; description?: unknown; issuetype: { name: string }; parent?: { key: string } };
      }>;
    };
    return data.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      description: adfDescriptionToText(issue.fields.description),
      issueType: issue.fields.issuetype.name as JiraIssueType,
      parentKey: issue.fields.parent?.key,
    }));
  }

  async transitionToStatus(key: string, statusName: string): Promise<void> {
    const transitionsResponse = await this.request(`/rest/api/3/issue/${key}/transitions`, { method: "GET" });
    const { transitions } = (await transitionsResponse.json()) as {
      transitions: Array<{ id: string; name: string }>;
    };
    const match = transitions.find((t) => t.name.toLowerCase() === statusName.toLowerCase());
    if (!match) {
      throw new Error(`No transition to "${statusName}" available for ${key} (available: ${transitions.map((t) => t.name).join(", ")})`);
    }
    await this.request(`/rest/api/3/issue/${key}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
  }
}
