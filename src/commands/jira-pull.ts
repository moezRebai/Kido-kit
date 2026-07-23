import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { ensureDir, kebabCase } from "../lib/fs-utils.js";
import { writeChangeMeta } from "../lib/change-meta.js";
import { setFrontmatterValue } from "../lib/frontmatter.js";
import { resolveJiraCredentials } from "../jira/credentials.js";
import { JiraClient, type JiraIssueDetails } from "../jira/client.js";

/** Reverse of jira-sync.ts's attachSpecFiles: downloads a real-file attachment (functional-spec.md
 * or design.md) straight into the change dir — byte-exact, since the description only ever holds
 * a short summary now, not the full content. Returns false (and logs a note) if the issue has no
 * such attachment, e.g. an Epic created via `--epic` that was never synced with a spec on disk. */
async function writeAttachedFile(
  client: JiraClient,
  issue: JiraIssueDetails,
  dir: string,
  filename: string
): Promise<boolean> {
  const attachment = issue.attachments?.find((a) => a.filename === filename);
  if (!attachment) {
    console.log(`No ${filename} attachment on ${issue.key} — skipping.`);
    return false;
  }
  const bytes = await client.downloadAttachmentContent(attachment.contentUrl);
  writeFileSync(join(dir, filename), bytes);
  return true;
}

/** syncFeatureStory (jira-sync.ts) always prefixes a small-feature Story's description
 * with this heading, even before design.md exists — the stable signal that distinguishes
 * a self-contained feature-spec Story from an ordinary task Story under the same Epic. */
function looksLikeFeatureSpec(description: string): boolean {
  return /^##\s+Functional Spec\s*\n/.test(description.trim());
}

function writeArtifact(path: string, title: string, body: string, jiraKey?: string): void {
  let content = `# ${title}\n\n${body}\n`;
  if (jiraKey) content = setFrontmatterValue(content, "jiraId", jiraKey);
  writeFileSync(path, content, "utf8");
}

function resolveChangeDir(repoRoot: string, summary: string, asName: string | undefined): { name: string; dir: string } {
  const paths = resolveKidoPaths(repoRoot);
  const name = asName ?? kebabCase(summary);
  return { name, dir: paths.changeDir(name) };
}

function materializeBug(repoRoot: string, issue: JiraIssueDetails, asName: string | undefined): string {
  const { name, dir } = resolveChangeDir(repoRoot, issue.summary, asName);
  if (existsSync(dir)) {
    console.log(`Change "${name}" already exists at ${dir} — overwriting bug.md from ${issue.key}.`);
  }
  ensureDir(dir);
  writeArtifact(join(dir, "bug.md"), issue.summary, issue.description, issue.key);
  writeChangeMeta(dir, { type: "bug", createdAt: new Date().toISOString() });
  console.log(`Pulled ${issue.key} into ${dir}`);
  return name;
}

async function materializeFeature(
  repoRoot: string,
  client: JiraClient,
  epic: JiraIssueDetails,
  asName: string | undefined
): Promise<string> {
  const { name, dir } = resolveChangeDir(repoRoot, epic.summary, asName);
  if (existsSync(dir)) {
    console.log(`Change "${name}" already exists at ${dir} — overwriting from ${epic.key}.`);
  }
  ensureDir(dir);

  await writeAttachedFile(client, epic, dir, "functional-spec.md");
  await writeAttachedFile(client, epic, dir, "design.md");

  const children = await client.searchChildIssues(epic.key);
  if (children.length > 0) {
    const tasksBody = children
      .map((child, i) => `## Task ${i + 1}: ${child.summary}\n\n**Jira:** ${child.key}\n\n${child.description}`)
      .join("\n\n");
    writeFileSync(join(dir, "tasks.md"), tasksBody + "\n", "utf8");
  }

  writeChangeMeta(dir, { type: "feature", createdAt: new Date().toISOString() });
  console.log(`Pulled ${epic.key} (+ ${children.length} Stories) into ${dir}`);
  return name;
}

/** A small, self-contained feature filed as a single Story under an Epic BA already had
 * (not one Kido created) — no tasks.md, since that mode never produces a task breakdown. */
async function materializeSmallFeature(
  client: JiraClient,
  repoRoot: string,
  story: JiraIssueDetails,
  asName: string | undefined
): Promise<string> {
  const { name, dir } = resolveChangeDir(repoRoot, story.summary, asName);
  if (existsSync(dir)) {
    console.log(`Change "${name}" already exists at ${dir} — overwriting from ${story.key}.`);
  }
  ensureDir(dir);

  await writeAttachedFile(client, story, dir, "functional-spec.md");
  await writeAttachedFile(client, story, dir, "design.md");

  writeChangeMeta(dir, { type: "feature", createdAt: new Date().toISOString() });
  console.log(`Pulled ${story.key} into ${dir} (small feature under an existing Epic — no tasks.md)`);
  return name;
}

/** Materializes a Jira issue (Epic, Story, or Bug) into a local kido/changes/<name>/
 * folder — the reverse of `kido jira sync`. Given a Story, first checks whether it's a
 * self-contained small-feature Story (see materializeSmallFeature) before falling back to
 * resolving its parent Epic, so Dev gets the full change context (functional-spec.md +
 * design.md + tasks.md), matching /kido:apply's existing context bundle. Returns the
 * resolved local change name. */
export async function runJiraPull(repoRoot: string, key: string, asName?: string): Promise<string> {
  const client = new JiraClient(resolveJiraCredentials(repoRoot));
  const issue = await client.getIssue(key);

  if (issue.issueType === "Bug") {
    return materializeBug(repoRoot, issue, asName);
  }

  let epic = issue;
  if (issue.issueType === "Story") {
    if (looksLikeFeatureSpec(issue.description)) {
      return materializeSmallFeature(client, repoRoot, issue, asName);
    }
    if (!issue.parentKey) {
      throw new Error(`Story ${issue.key} has no parent Epic — can't resolve full change context from it alone.`);
    }
    epic = await client.getIssue(issue.parentKey);
  }
  if (epic.issueType !== "Epic") {
    throw new Error(`${key} is a ${issue.issueType}, not a Bug/Story/Epic — don't know how to pull it.`);
  }

  return materializeFeature(repoRoot, client, epic, asName);
}
