import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { JiraCredentials } from "./credentials.js";
import { markdownToAdf, adfToMarkdown } from "./adf.js";

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

export interface JiraAttachment {
  id: string;
  filename: string;
  /** Jira's `content` field — an absolute URL to GET the raw attachment bytes. */
  contentUrl: string;
}

export interface JiraIssueDetails {
  key: string;
  summary: string;
  description: string;
  issueType: JiraIssueType;
  parentKey?: string | undefined;
  /** Only populated by getIssue — searchChildIssues' results never carry this. */
  attachments?: JiraAttachment[] | undefined;
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
      description: markdownToAdf(input.description),
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
          description: markdownToAdf(input.description),
        },
      }),
    });
  }

  /** Reads a single issue back — the reverse of createIssue/updateIssue, used by `kido jira pull`. */
  async getIssue(key: string): Promise<JiraIssueDetails> {
    const response = await this.request(
      `/rest/api/3/issue/${key}?fields=summary,description,issuetype,parent,attachment`,
      { method: "GET" }
    );
    const data = (await response.json()) as {
      key: string;
      fields: {
        summary: string;
        description?: unknown;
        issuetype: { name: string };
        parent?: { key: string };
        attachment?: Array<{ id: string; filename: string; content: string }>;
      };
    };
    return {
      key: data.key,
      summary: data.fields.summary,
      description: adfToMarkdown(data.fields.description),
      issueType: data.fields.issuetype.name as JiraIssueType,
      parentKey: data.fields.parent?.key,
      attachments: data.fields.attachment?.map((a) => ({ id: a.id, filename: a.filename, contentUrl: a.content })),
    };
  }

  /** Lists Stories nested under an Epic, oldest first — used to reconstruct tasks.md on pull.
   * Uses /search/jql (the GET /search endpoint it replaces was removed by Atlassian, 410 Gone)
   * and follows its cursor-based nextPageToken until exhausted, since an Epic's children can
   * span more than one page. */
  async searchChildIssues(epicKey: string): Promise<JiraIssueDetails[]> {
    const jql = encodeURIComponent(`parent = ${epicKey} ORDER BY created ASC`);
    const issues: Array<{
      key: string;
      fields: { summary: string; description?: unknown; issuetype: { name: string }; parent?: { key: string } };
    }> = [];
    let nextPageToken: string | undefined;
    do {
      const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const response = await this.request(
        `/rest/api/3/search/jql?jql=${jql}&fields=summary,description,issuetype,parent${tokenParam}`,
        { method: "GET" }
      );
      const data = (await response.json()) as {
        issues: typeof issues;
        nextPageToken?: string;
        isLast?: boolean;
      };
      issues.push(...data.issues);
      nextPageToken = data.isLast === false ? data.nextPageToken : undefined;
    } while (nextPageToken);

    return issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      description: adfToMarkdown(issue.fields.description),
      issueType: issue.fields.issuetype.name as JiraIssueType,
      parentKey: issue.fields.parent?.key,
    }));
  }

  /** Uploads a real file as a new attachment. Bypasses this.request() — multipart needs fetch to
   * set its own Content-Type boundary, not the shared JSON one. Reads the file fresh off disk
   * each call, so callers must write any frontmatter mutation (e.g. jiraId) to `filePath`
   * *before* calling this, not after. */
  async attachFile(key: string, filePath: string): Promise<JiraAttachment> {
    const buffer = readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), basename(filePath));
    const response = await fetch(`${this.creds.baseUrl}/rest/api/3/issue/${key}/attachments`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "X-Atlassian-Token": "no-check",
        Accept: "application/json",
      },
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }
    const [attachment] = (await response.json()) as Array<{ id: string; filename: string; content: string }>;
    return { id: attachment!.id, filename: attachment!.filename, contentUrl: attachment!.content };
  }

  /** Jira attachments can't be updated in place — callers delete an existing one by ID before a
   * fresh upload, so re-syncing doesn't pile up duplicate copies of the same file. */
  async deleteAttachment(attachmentId: string): Promise<void> {
    await this.request(`/rest/api/3/attachment/${attachmentId}`, { method: "DELETE" });
  }

  /** Downloads an attachment's raw bytes. A different shape from this.request()'s JSON handling,
   * and contentUrl is already an absolute URL (from getIssue's attachment metadata), not a path. */
  async downloadAttachmentContent(contentUrl: string): Promise<Buffer> {
    const response = await fetch(contentUrl, { headers: { Authorization: this.authHeader() } });
    if (!response.ok) {
      throw new Error(`Jira API error ${response.status}: failed to download attachment`);
    }
    return Buffer.from(await response.arrayBuffer());
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
