# 09 — Atlassian integrations (Jira, Bitbucket, Confluence)

All three are **skills with a bundled script** (no MCP). The skill explains when to call the script and
what to confirm with the user; the script does every API call deterministically.

Common rules:
- Every write is preceded by a user confirmation in the calling skill (🛑).
- Every write is **idempotent**: re-running never duplicates.
- External identifiers are written back to local files **immediately after each successful creation**,
  never batched at the end.
- Scripts print a JSON result with `--json` and a human summary otherwise; exit code ≠ 0 on failure with
  the HTTP status and a short server message (no token, no full body dump).

## 1. Credentials

`~/.config/kilo/teamflow.credentials` (JSON), next to Kilo's own configuration, created by the bootstrap installer or
`tf-packs doctor --setup`, permissions **0600** (on Windows: ACL limited to the current user). Exact
Kilo configuration folder confirmed in WP-02 **(verify)**. Never in a repository. Every token is
**personal** to the developer (read-only where the service allows it).

```json
{
  "jira":       { "baseUrl": "https://jira.example.internal", "deployment": "server", "token": "<PAT>" },
  "bitbucket":  { "baseUrl": "https://bitbucket.example.internal", "token": "<HTTP access token or PAT>" },
  "confluence": { "baseUrl": "https://confluence.example.internal", "token": "<PAT>" },
  "sonarqube":  { "baseUrl": "https://sonar.example.internal", "token": "<user token>" },
  "checkmarx":  { "baseUrl": "https://checkmarx.example.internal", "token": "<token>" },
  "artifactory":{ "baseUrl": "https://artifactory.example.internal/artifactory", "token": "<optional, for private reads>" },
  "tls":        { "caFile": null, "allowInsecure": false }
}
```

- Environment variables override file values: `TEAMFLOW_<SERVICE>_BASE_URL`, `TEAMFLOW_<SERVICE>_TOKEN`
  (e.g. `TEAMFLOW_JIRA_TOKEN`).
- Data Center authentication: `Authorization: Bearer <PAT>`. Jira Cloud (`deployment: "cloud"`) keeps
  Basic auth with `email` + API token.
- Internal CAs: `tls.caFile` is passed as `NODE_EXTRA_CA_CERTS` to scripts. `allowInsecure` exists as a
  last resort, prints a warning on every call, and can be forbidden by org policy.
- Interactive token entry is masked.

## 2. `tf-jira`

Script `jira.mjs` — built from the existing Jira modules in this repository ([12](12-reusable-code.md)).

| Command | Effect |
|---|---|
| `sync --topic <id> [--epic <KEY>]` | Push the topic to Jira (see mapping) |
| `pull <KEY> [--as <topic-id>]` | Materialize a topic folder from a Jira Epic, Story or Bug |
| `transition <KEY> --to <status>` | Move an issue through a workflow transition by name |
| `show <KEY>` | Read-only summary |
| `doctor` | Check credentials, project, issue types, Epic fields |

### 2.1 Mapping

| Local | Jira | Description |
|---|---|---|
| `functional-spec.md` (+ `design.md`) of a multi-task feature | Epic | Short summary (text before the first `##`) + note; spec files **and `state.md`** attached |
| Small feature filed under an existing Epic (`jira.epic` preset) | Story under that Epic | Prefix `## Functional Spec` + summary; files attached |
| Each `## Task n` of `tasks.md` | Story under the Epic | Task body, converted (wiki markup on DC, ADF on Cloud); Component / Priority (from Criticality) / Sprint resolved by name, skipped with a warning when unknown |
| `bug.md` | Bug | Full body converted |

Identifiers: Epic/Story/Bug keys are stored in the topic's `state.md` (`jira.*`, `tasks[].jira`) **and**
in the file (frontmatter `jira:` for spec/bug files, `**Jira:** KEY` line under each task heading).

### 2.2 Data Center specifics (MUST)

- **Epic creation:** classic Jira DC projects require the *Epic Name* custom field. `doctor` discovers it
  from `/rest/api/2/field` (custom type `com.pyxis.greenhopper.jira:gh-epic-label`) and `sync` fills it
  with the Epic summary.
- **Story → Epic link:** on DC use the *Epic Link* custom field (custom type
  `com.pyxis.greenhopper.jira:gh-epic-link`), not `parent`. `parent` is used only on Cloud /
  team-managed projects. `doctor` reports which mechanism applies.
- Children search: `POST /rest/api/2/search` with JQL `"Epic Link" = <KEY>` on DC, `parent = <KEY>` on Cloud.

### 2.3 Idempotency and robustness (MUST — corrects known defects of the reused code)

1. After **each** Story creation, write the `**Jira:**` line to `tasks.md` and update `state.md`
   before creating the next Story, so a failure mid-run never loses created keys.
2. Insert the `**Jira:**` line by **task number**, not by title, so two tasks with the same title are
   handled correctly.
3. Attachments: upload the new file **first**, then delete the previous attachment with the same name;
   never leave the issue without the spec.
4. Before creating, if no key is stored, search for an existing issue with the same summary created by
   TeamFlow in the Epic (label `teamflow`) to recover from a lost write; ask the user before adopting it.
5. All created issues get the label `teamflow`.

### 2.4 Pull

`pull <KEY>` resolves: Epic (or one of its Stories) → spec files downloaded byte-exact from attachments
+ `tasks.md` rebuilt from child Stories; small-feature Story → spec files from attachments; Bug →
`bug.md`. It restores `state.md` byte-exact from the attachment when present (topics created through
TeamFlow); otherwise it creates one with phase `implement` (gates `spec-approved`/`plan-approved` recorded
as `by: jira:<KEY>`), so `tf-implement` can start immediately. If the topic folder exists, it refuses unless
`--force` after user confirmation.

## 3. `tf-bitbucket`

Script `bitbucket.mjs`. Bitbucket **Data Center** REST API 1.0.

| Command | Effect |
|---|---|
| `branch --name <b> [--from <ref>]` | Create the branch locally with git and push it with upstream (`git push -u origin <b>`) |
| `pr --topic <id> [--target <branch>]` | Create or update the pull request for the topic branch: `POST /rest/api/1.0/projects/{project}/repos/{repo}/pull-requests`; title from the spec title (+ Jira key); description from spec summary, task list, check results and waivers; reviewers from config; stores `pr` in `state.md` |
| `pr-status --topic <id>` | Read PR state, approvals, build statuses |
| `doctor` | Check credentials, project/repo, permissions |

Idempotency: `pr` first looks for an open PR from the same source branch and updates it
(`PUT …/pull-requests/{id}` with its current `version`) instead of creating a second one. Project and
repo default to values parsed from `git remote get-url origin` when not set in config.

## 4. `tf-confluence`

Script `confluence.mjs`. Confluence **Data Center** REST API (`/rest/api/content`). **One-way**:
repository → Confluence.

| Command | Effect |
|---|---|
| `publish [--doc functional\|technical\|adr\|all]` | Create or update one page per document under `parentPageId` in `space` |
| `status` | Show page ids, versions, and whether a page was edited outside TeamFlow |
| `doctor` | Check credentials, space, parent page |

Rules:
- Markdown is converted to Confluence **storage format** (XHTML) by a new converter
  (`src/confluence/storage.ts`) reusing the shared Markdown block parser; Mermaid blocks are published as
  code blocks followed by a link to the matching HTML diagram in the repository (decision D-35).
- Page identity is stored in the document frontmatter (`confluence: { pageId, version }`).
- Updates use `PUT` with `version.number = stored + 1`. If the remote version is higher than the stored
  one (someone edited the page in Confluence), publishing **stops** and asks the user; the page footer
  states "Generated by TeamFlow from <repo>/<path> — edit the source, not this page".

## 5. Tests

Each script is tested with `node --test` against a local fake HTTP server (same approach as this
repository's existing Jira tests), covering: create, update, re-run without change (no write), failure
mid-run then re-run (no duplicate), DC vs Cloud field differences, permission errors.
