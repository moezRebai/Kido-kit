import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKidoPaths } from "../lib/kido-paths.js";
import { readChangeMeta } from "../lib/change-meta.js";
import { parseFrontmatter, setFrontmatterValue } from "../lib/frontmatter.js";
import { parseTasks, extractTitleAndBody } from "../lib/tasks-parser.js";
import { resolveJiraCredentials } from "../jira/credentials.js";
import { JiraClient } from "../jira/client.js";

const JIRA_LINE = /^\*\*Jira:\*\*\s*(\S+)\s*$/m;

export async function runJiraSync(repoRoot: string, changeName: string, explicitEpicKey?: string): Promise<void> {
  const paths = resolveKidoPaths(repoRoot);
  const changeDir = paths.changeDir(changeName);
  const meta = readChangeMeta(changeDir);
  const type = meta?.type ?? "feature";

  const client = new JiraClient(resolveJiraCredentials(repoRoot));

  if (type === "bug") {
    await syncSingleIssueFile(client, join(changeDir, "bug.md"), "Bug");
    return;
  }

  const functionalSpecPath = join(changeDir, "functional-spec.md");
  const designPath = join(changeDir, "design.md");
  let epicKey: string | undefined;
  if (existsSync(functionalSpecPath)) {
    // Still syncs functional-spec.md to its own Epic either way (useful
    // bookkeeping regardless), but an explicit --epic always wins as the
    // parent for Stories below — e.g. Dev-only changes with no
    // functional-spec.md, or attaching to an Epic that already existed in
    // Jira before this repo adopted Kido.
    epicKey = await syncEpic(client, functionalSpecPath, existsSync(designPath) ? designPath : undefined);
  }
  epicKey = explicitEpicKey ?? epicKey;

  const tasksPath = join(changeDir, "tasks.md");
  if (existsSync(tasksPath)) {
    await syncTasksAsStories(client, tasksPath, epicKey);
  } else {
    console.log("No tasks.md found — nothing to sync as Stories.");
  }
}

/** Syncs a single-issue file (bug.md -> Bug), using frontmatter for idempotency. */
async function syncSingleIssueFile(client: JiraClient, path: string, issueType: "Bug"): Promise<string> {
  const content = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  const { title, body: description } = extractTitleAndBody(body);

  const existingKey = frontmatter.jiraId as string | undefined;
  if (existingKey) {
    await client.updateIssue(existingKey, { summary: title, description });
    console.log(`Updated ${issueType} ${existingKey}`);
    return existingKey;
  }

  const result = await client.createIssue({ summary: title, description, issueType });
  writeFileSync(path, setFrontmatterValue(content, "jiraId", result.key), "utf8");
  console.log(`Created ${issueType} ${result.key} (${result.url})`);
  return result.key;
}

/** Syncs functional-spec.md (+ design.md, if present) to a single Epic — two labeled
 * sections in one description field, since Jira's hierarchy has no separate tier for
 * design.md (Epic -> Story only). Idempotency stays keyed off functional-spec.md's
 * jiraId frontmatter; design.md doesn't get its own Jira ID. */
async function syncEpic(client: JiraClient, specPath: string, designPath: string | undefined): Promise<string> {
  const specContent = readFileSync(specPath, "utf8");
  const { frontmatter, body: specBody } = parseFrontmatter(specContent);
  const { title, body: specDescription } = extractTitleAndBody(specBody);

  let description = specDescription;
  if (designPath) {
    const designContent = readFileSync(designPath, "utf8");
    const { body: designBody } = parseFrontmatter(designContent);
    const { body: designDescription } = extractTitleAndBody(designBody);
    description = `## Functional Spec\n\n${specDescription}\n\n## Design\n\n${designDescription}`;
  }

  const existingKey = frontmatter.jiraId as string | undefined;
  if (existingKey) {
    await client.updateIssue(existingKey, { summary: title, description });
    console.log(`Updated Epic ${existingKey}`);
    return existingKey;
  }

  const result = await client.createIssue({ summary: title, description, issueType: "Epic" });
  writeFileSync(specPath, setFrontmatterValue(specContent, "jiraId", result.key), "utf8");
  console.log(`Created Epic ${result.key} (${result.url})`);
  return result.key;
}

/** Syncs each `## Task N: <title>` section in tasks.md as a Jira Story nested under the Epic. */
async function syncTasksAsStories(client: JiraClient, tasksPath: string, epicKey: string | undefined): Promise<void> {
  let content = readFileSync(tasksPath, "utf8");
  const tasks = parseTasks(content);

  for (const task of tasks) {
    const existingMatch = JIRA_LINE.exec(task.body);
    if (existingMatch) {
      const key = existingMatch[1]!;
      await client.updateIssue(key, { summary: task.title, description: task.body });
      console.log(`Updated Story ${key}: ${task.title}`);
      continue;
    }

    const result = await client.createIssue({
      summary: task.title,
      description: task.body,
      issueType: "Story",
      ...(epicKey ? { parentKey: epicKey } : {}),
    });
    console.log(`Created Story ${result.key}: ${task.title} (${result.url})`);

    // Insert a **Jira:** marker right after this task's heading so re-syncing is idempotent.
    const headingPattern = new RegExp(`(##\\s+Task\\s+\\d+:\\s*${escapeRegExp(task.title)}\\s*\\n)`);
    content = content.replace(headingPattern, `$1\n**Jira:** ${result.key}\n`);
  }

  writeFileSync(tasksPath, content, "utf8");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
