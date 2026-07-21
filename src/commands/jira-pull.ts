import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { ensureDir, kebabCase } from "../lib/fs-utils.js";
import { writeChangeMeta } from "../lib/change-meta.js";
import { setFrontmatterValue } from "../lib/frontmatter.js";
import { resolveJiraCredentials } from "../jira/credentials.js";
import { JiraClient, type JiraIssueDetails } from "../jira/client.js";

/** Reverse of jira-sync.ts's syncEpic/syncFeatureStory: splits a combined Epic or
 * feature-spec-Story description back into functional-spec.md's body and (if present)
 * design.md's body. Shape is identical either way — "## Functional Spec" / "## Design". */
function splitEpicDescription(description: string): { functionalBody: string; designBody?: string } {
  const parts = description.split(/\n##\s+Design\s*\n+/);
  const functionalBody = (parts[0] ?? "").replace(/^##\s+Functional Spec\s*\n+/, "").trim();
  if (parts.length < 2) {
    return { functionalBody };
  }
  return { functionalBody, designBody: parts.slice(1).join("\n\n## Design\n\n").trim() };
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

  const { functionalBody, designBody } = splitEpicDescription(epic.description);
  writeArtifact(join(dir, "functional-spec.md"), epic.summary, functionalBody, epic.key);
  if (designBody) {
    writeArtifact(join(dir, "design.md"), epic.summary, designBody);
  }

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
function materializeSmallFeature(repoRoot: string, story: JiraIssueDetails, asName: string | undefined): string {
  const { name, dir } = resolveChangeDir(repoRoot, story.summary, asName);
  if (existsSync(dir)) {
    console.log(`Change "${name}" already exists at ${dir} — overwriting from ${story.key}.`);
  }
  ensureDir(dir);

  const { functionalBody, designBody } = splitEpicDescription(story.description);
  writeArtifact(join(dir, "functional-spec.md"), story.summary, functionalBody, story.key);
  if (designBody) {
    writeArtifact(join(dir, "design.md"), story.summary, designBody);
  }

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
      return materializeSmallFeature(repoRoot, issue, asName);
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
