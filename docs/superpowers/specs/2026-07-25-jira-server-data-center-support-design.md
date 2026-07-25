# Jira Server/Data Center support

## Problem

Kido's built-in Jira integration (`src/jira/`, used by `kido init`'s setup prompt,
`kido jira sync`, and `kido jira pull`) only speaks Jira Cloud: Basic auth
(email + API token), the `/rest/api/3` REST API, and Atlassian Document Format
(ADF) for issue descriptions/comments. A user running Jira Server or Data
Center (common in on-prem/company-hosted instances) can't use it — Server/DC
uses Personal Access Token (Bearer) auth, the `/rest/api/2` REST API, and
Jira wiki markup instead of ADF (Server/DC's REST v2 doesn't understand ADF
at all; sending it would produce broken/garbled descriptions).

The user has already built and verified this exact Cloud/Server split in a
separate, general-purpose Jira agent skill
(`C:\Solutions\Skills\skills\jira`). Kido already ports code from that skill
once before — `src/jira/adf.ts` is a typed port of the skill's
`scripts/adf.mjs`, with a comment noting Kido keeps its own copy rather than
depending on the skill at runtime. This change follows the same pattern:
port the skill's Cloud/Server split into Kido's own `src/jira/*`, typed,
adapted to Kido's existing credential-resolution and CLI conventions.

## Goals

- `kido init`'s Jira setup, `kido jira sync`, and `kido jira pull` all work
  against a Jira Server/Data Center instance using a Personal Access Token.
- Issue descriptions and comments render correctly on Server/DC (wiki markup,
  not ADF).
- Self-signed/internal-CA TLS certificates are supported the same way the
  skill supports them (`NODE_EXTRA_CA_CERTS` as the documented proper fix,
  `allowInsecureTls` as a last resort).
- Existing Jira Cloud support is unchanged in behavior for anyone not opting
  into `deploymentType: "server"` — this is purely additive. (Kido is a
  general-purpose tool per its own README/DESIGN.md, not scoped to one
  company's Jira instance, so Cloud support stays.)

## Non-goals

- No `whoami`/credential-verification call added to `kido init`'s setup flow
  — it doesn't verify Cloud credentials today either; this change doesn't
  change that behavior.
- No interactive prompt for `allowInsecureTls` in `kido init` — it's an
  advanced/rare case (self-signed cert on an internal Server/DC instance),
  set via env var or a manual edit to `.kido-credentials` instead of a
  first-class setup question.
- No changes to `kido jira sync`'s attach-and-summarize logic, idempotency
  behavior, or the Epic/Story/Bug hierarchy — only how requests are
  authenticated, addressed, and encoded changes, not what Kido does with
  Jira.
- No general-purpose `search-issues`/`whoami`/`list-projects`/etc. actions —
  Kido's Jira client only implements the specific operations `jira sync`/
  `jira pull` need (as today), not the skill's full action surface.

## Design

### `src/jira/credentials.ts`

```ts
export interface JiraCredentials {
  baseUrl: string;
  email?: string; // Server/DC doesn't use this — PAT-only auth
  apiToken: string;
  projectKey: string;
  deploymentType: "cloud" | "server";
  allowInsecureTls?: boolean;
}
```

- New env vars: `KIDO_JIRA_DEPLOYMENT_TYPE`, `KIDO_JIRA_ALLOW_INSECURE_TLS`
  (added to `JIRA_ENV_VAR_NAMES`).
- New `.kido-credentials` file keys: `deploymentType`, `allowInsecureTls`.
- `isComplete()`:
  - `deploymentType === "server"`: `baseUrl && apiToken && projectKey`
    (no `email`).
  - otherwise (`"cloud"`, including unset — default): `baseUrl && email &&
    apiToken && projectKey` (unchanged from today).
- A `normalize()` step (mirroring the skill's) coerces `deploymentType` to
  `"cloud"` unless it's exactly `"server"`, and `allowInsecureTls` to a real
  boolean (env vars arrive as strings — `"true"` must become `true`).
- `hasResolvableJiraCredentials` / `resolveJiraCredentials` /
  `writeJiraCredentialsFile` keep their existing signatures and repo-root
  file location (`.kido-credentials`, gitignored) — this change only widens
  what counts as "complete" and what fields exist, not where or how
  credentials are stored.

### `src/jira/markdown-blocks.ts` (new)

Extracts the markdown block-splitter/parser (`splitIntoBlocks`, `parseBlock`,
and their supporting types/helpers for headings, fenced code, bullet/ordered
lists, paragraphs, inline formatting) that's currently inlined in `adf.ts`.
Both `adf.ts` and the new `wiki.ts` need identical block-splitting — the
Jira-format-specific part is only how each *node* renders, not how markdown
is *segmented* into blocks. This mirrors the skill's own current shape (it
extracted the same shared module for the same reason, after Kido's `adf.ts`
was ported from an earlier, pre-extraction version of the skill).

`adf.ts` is refactored to import `splitIntoBlocks`/`parseBlock` from this new
module instead of defining them inline; its own node-to-ADF /
ADF-to-markdown rendering functions are unchanged.

### `src/jira/wiki.ts` (new)

Typed port of the skill's `scripts/wiki.mjs`: `markdownToWiki(markdown):
string` and `wikiToMarkdown(wiki: string): string`, built on
`markdown-blocks.ts`'s shared parser. Same node-type coverage as `adf.ts`
(headings, paragraphs, fenced code blocks, bullet/ordered lists, bold/
italic/inline-code/links) — headings render as `h1.`..`h6.`, bold as
`*text*`, italic as `_text_`, inline code as `{{text}}`, links as
`[text|href]`, code blocks as `{code:lang}...{code}`, bullets as `* item`,
ordered lists as `# item` (Jira wiki markup's own list syntax, not
numbered).

### `src/jira/client.ts`

- `const API_BASE = { cloud: "/rest/api/3", server: "/rest/api/2" };` — the
  constructor picks `this.apiBase` from `creds.deploymentType` once, used
  everywhere `request()` currently hardcodes `/rest/api/3`.
- `authHeader()`: `Bearer ${this.creds.apiToken}` when
  `deploymentType === "server"`, otherwise the existing `Basic
  base64(email:apiToken)`.
- TLS: a `withTlsEnv(creds, fn)` helper (ported from the skill) that, only
  when `creds.allowInsecureTls` is true, sets
  `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` for the duration of `fn`
  and restores the prior value (or deletes it) afterward. Wraps every fetch
  call in the client — both calls that go through the shared `request()`
  helper and the two that bypass it for multipart (`attachFile`) and raw
  bytes (`downloadAttachmentContent`).
- Body encoding: `createIssue`, `updateIssue`, and `getIssue` switch between
  `markdownToAdf`/`adfToMarkdown` (cloud) and `markdownToWiki`/
  `wikiToMarkdown` (server) based on `deploymentType`, via a small
  `formatBody`/`parseBody` pair on the client (same shape as the skill's).
- `searchChildIssues(epicKey)` (used by `kido jira pull` to reconstruct
  `tasks.md` from an Epic's child Stories): keeps its existing Cloud
  implementation (`GET /rest/api/3/search/jql`, cursor `nextPageToken`
  pagination) for `deploymentType === "cloud"`. Adds a Server/DC
  implementation using `POST /rest/api/2/search` with a JSON body
  (`{ jql, fields, startAt, maxResults }`), paginating by incrementing
  `startAt` by `maxResults` until `startAt >= total` in the response. Both
  paths return the same `JiraIssueDetails[]` shape — the pagination
  mechanism is the only difference, hidden behind one method.

### `kido init`'s Jira setup (`src/commands/init.ts`, `handleJiraSetup`)

Before the existing `baseUrl` prompt, add:

```ts
const isServer = await prompt.askYesNo("Is this a Server/Data Center instance?", false);
```

- If `isServer`: skip the `email` prompt entirely; the token prompt reads
  "Jira Personal Access Token:" instead of "Jira API token:";
  `writeJiraCredentialsFile` is called with `deploymentType: "server"` and no
  `email` field.
- If not: existing Cloud flow, unchanged, with `deploymentType: "cloud"`
  written explicitly (rather than relying on the field being absent) so the
  file is self-describing.

The non-interactive fallback message (no TTY) and the
`--skip-jira-setup`/env-var guidance text stay as-is other than mentioning
the two new env vars in the printed list.

### Documentation

- `README.md`'s Jira credential-setup mention and `DESIGN.md`'s Jira
  architecture section get a short update noting both deployment types are
  supported, matching the shape of this spec's Goals section — not a
  rewrite of either doc.

## Testing

- `test/wiki.test.ts` (new): ported test cases from the skill's
  `scripts/wiki.test.mjs`, covering `markdownToWiki`/`wikiToMarkdown`
  round-trips for headings, lists, code blocks, inline formatting, and
  links.
- `test/init-jira-setup.test.ts`: extended with cases for the new
  Server/DC branch — the PAT-labeled prompt, no email prompt, and
  `deploymentType: "server"` written to the credentials file.
- `test/jira-client-server-mode.test.ts` (new): a small, purpose-built fake
  Server/DC HTTP server, driving `JiraClient` directly (not through the full
  `jira sync`/`jira pull` command layer) — asserting the `Authorization:
  Bearer ...` header, the `/rest/api/2` path prefix, wiki-markup (not ADF)
  request bodies, and the `POST /rest/api/2/search` `startAt`/`maxResults`
  pagination path for `searchChildIssues`. Chosen over retrofitting the
  existing ~450-line Cloud-oriented fake servers in `jira-sync.test.ts`/
  `jira-pull.test.ts` to branch on deployment type — smaller, more reliable
  to get right, and still exercises every new branch in `client.ts`
  end-to-end against a real (fake) HTTP server. The existing Cloud tests in
  those two files are unchanged.
- No new shared fake-Jira-server module beyond that one new file — matches
  Kido's existing pattern of each test file owning its own inline fake
  server rather than a shared `fake-jira-server.mjs`-style helper.

## Open questions

None — scope, credential shape, API/body differences, and testing approach
were confirmed interactively before writing this spec.
