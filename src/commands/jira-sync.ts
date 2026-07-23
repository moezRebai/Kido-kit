import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
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
    const existingEpicId = parseFrontmatter(readFileSync(functionalSpecPath, "utf8")).frontmatter.epicId as
      | string
      | undefined;
    if (existingEpicId) {
      // Small-feature-under-an-existing-Epic mode (decision: post-implementation
      // revision): functional-spec.md + design.md sync as a single Story nested
      // under an Epic BA already has, not a new Epic of our own — so there's
      // nothing here for tasks.md's Stories to nest under via this path (that
      // mode intentionally has no tasks.md at all).
      await syncFeatureStory(client, functionalSpecPath, existsSync(designPath) ? designPath : undefined, existingEpicId);
    } else {
      // Still syncs functional-spec.md to its own Epic either way (useful
      // bookkeeping regardless), but an explicit --epic always wins as the
      // parent for Stories below — e.g. Dev-only changes with no
      // functional-spec.md, or attaching to an Epic that already existed in
      // Jira before this repo adopted Kido.
      epicKey = await syncEpic(client, functionalSpecPath, existsSync(designPath) ? designPath : undefined);
    }
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

/** Positional heuristic only — never match specific heading text, since functional-spec.md has
 * no enforced section-naming schema: everything up to the first `##` after the title is treated
 * as "the overview," whatever it's titled. */
function firstSection(body: string): string {
  const match = /\n##\s+/.exec(body);
  return (match ? body.slice(0, match.index) : body).trim();
}

/** The Epic/feature-Story description is a short summary, not the full spec — the full
 * functional-spec.md/design.md content goes up as real file attachments instead (see
 * attachSpecFiles), both because it's more readable for a BA/PM-facing ticket and because it
 * makes kido jira pull's reconstruction byte-exact instead of a lossy markdown<->ADF round trip. */
function buildAttachSummary(specDescription: string, hasDesign: boolean): string {
  const overview = firstSection(specDescription);
  const filesNote = hasDesign
    ? "The full **functional-spec.md** and **design.md** are attached to this ticket."
    : "The full **functional-spec.md** is attached to this ticket.";
  return overview ? `${overview}\n\n${filesNote}` : filesNote;
}

/** Uploads specPath (+ designPath) as real-file attachments on `key`, deleting any existing
 * attachment with the same filename first — Jira can't update an attachment in place, so without
 * this, re-syncing would pile up duplicate copies on every run. Must be called *after* the issue
 * is created/updated and *after* any frontmatter write to specPath (jiraId), since attachFile
 * re-reads the file from disk — this is what lets jira-pull.ts reconstruct the file with its
 * jiraId frontmatter already intact, with no separate injection step needed on that side.
 * Attachment matching is by exact filename — a manually-attached unrelated file sharing one of
 * these exact names would get silently replaced, but that's an unlikely enough scenario to accept. */
async function attachSpecFiles(client: JiraClient, key: string, specPath: string, designPath?: string): Promise<void> {
  const filePaths = designPath ? [specPath, designPath] : [specPath];
  const existing = await client.getIssue(key);
  for (const filePath of filePaths) {
    const filename = basename(filePath);
    const stale = existing.attachments?.find((a) => a.filename === filename);
    if (stale) await client.deleteAttachment(stale.id);
    await client.attachFile(key, filePath);
  }
}

/** Syncs functional-spec.md (+ design.md, if present) to a single Epic. Description is an
 * auto-extracted summary (see buildAttachSummary); the full files go up as attachments, not
 * embedded in the description. Idempotency stays keyed off functional-spec.md's jiraId
 * frontmatter; design.md doesn't get its own Jira ID. */
async function syncEpic(client: JiraClient, specPath: string, designPath: string | undefined): Promise<string> {
  const specContent = readFileSync(specPath, "utf8");
  const { frontmatter, body: specBody } = parseFrontmatter(specContent);
  const { title, body: specDescription } = extractTitleAndBody(specBody);
  const description = buildAttachSummary(specDescription, Boolean(designPath));

  const existingKey = frontmatter.jiraId as string | undefined;
  if (existingKey) {
    await client.updateIssue(existingKey, { summary: title, description });
    await attachSpecFiles(client, existingKey, specPath, designPath);
    console.log(`Updated Epic ${existingKey}`);
    return existingKey;
  }

  const result = await client.createIssue({ summary: title, description, issueType: "Epic" });
  writeFileSync(specPath, setFrontmatterValue(specContent, "jiraId", result.key), "utf8");
  await attachSpecFiles(client, result.key, specPath, designPath);
  console.log(`Created Epic ${result.key} (${result.url})`);
  return result.key;
}

/** Syncs functional-spec.md (+ design.md, if present) as a single Story nested under an
 * Epic BA already has — for a small, self-contained feature that doesn't need its own
 * Epic. Always prefixes with "## Functional Spec" (even before design.md exists), unlike
 * syncEpic's plain summary — that's the stable signal `kido jira pull` later uses to
 * recognize a self-contained feature-spec Story vs. an ordinary task Story. Same
 * summary-in-description + full-files-attached shape as syncEpic otherwise. */
async function syncFeatureStory(
  client: JiraClient,
  specPath: string,
  designPath: string | undefined,
  epicId: string
): Promise<string> {
  const specContent = readFileSync(specPath, "utf8");
  const { frontmatter, body: specBody } = parseFrontmatter(specContent);
  const { title, body: specDescription } = extractTitleAndBody(specBody);
  const description = `## Functional Spec\n\n${buildAttachSummary(specDescription, Boolean(designPath))}`;

  const existingKey = frontmatter.jiraId as string | undefined;
  if (existingKey) {
    await client.updateIssue(existingKey, { summary: title, description });
    await attachSpecFiles(client, existingKey, specPath, designPath);
    console.log(`Updated Story ${existingKey}`);
    return existingKey;
  }

  const result = await client.createIssue({ summary: title, description, issueType: "Story", parentKey: epicId });
  writeFileSync(specPath, setFrontmatterValue(specContent, "jiraId", result.key), "utf8");
  await attachSpecFiles(client, result.key, specPath, designPath);
  console.log(`Created Story ${result.key} (${result.url}) under existing Epic ${epicId}`);
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
