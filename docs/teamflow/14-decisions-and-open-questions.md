# 14 — Decisions and open questions

Status values: **Accepted** (agreed by the product owner), **Proposed** (recommended, awaiting
validation), **Superseded**. Add new decisions at the end; never renumber.

## 1. Decision log

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D-01 | Everything user-facing is a skill; no globally installed CLI | Accepted | One entry mechanism; skills carry their own scripts; no `npm link` |
| D-02 | No MCP servers; integrations are scripts calling REST APIs | Accepted | Organization constraint; also enables deterministic tests and Data Center support |
| D-03 | Deterministic operations (Jira/Bitbucket/Confluence writes, state transitions, pack install, tool pass/fail) are code, not prompt | Accepted | Prevents duplicates and inconsistent behavior |
| D-04 | Files in the repository are the source of truth; Jira/Confluence are mirrors | Accepted | Versioned, reviewable, works offline |
| D-05 | Two journeys (solo, team) share grooming and spec; mode chosen after spec approval unless `defaultMode` is set | Accepted | The difference is the handoff, not the method; the user knows the size after the spec |
| D-06 | `tf-forge` is the solo journey entry point, chaining the same skills as the team journey | Accepted | Single method, no duplicated prompts |
| D-07 | Routing = permanent rule + per-message plugin + router skill; the router skill decides | Accepted | A skill alone is not reliably invoked; code alone cannot understand intent |
| D-08 | Agents run only on explicit request or router match; `tf-archive` verifies required ones at ship time | Accepted | Predictable; nothing runs behind the user's back; nothing forgotten |
| D-09 | For tool agents, the tool decides pass/fail; the LLM triages and proposes fixes | Accepted | Same verdict as CI; no LLM judgment on security gates |
| D-10 | Customization by layered resolution: repo overrides > org overrides > installed packs > core | Accepted | Teams adapt without forking (amended by D-26: no repo-scope packs) |
| D-11 | Distribution as packs: Bitbucket DC source, Jenkins CI, Artifactory staging → release, `index.json` | Accepted | Uses existing infrastructure; no server needed for the MVP |
| D-12 | `teamflow/packs.lock` is committed and declares the pack versions a repository requires | Accepted | Same versions for the whole team |
| D-13 | Trust levels official / org / community; community packs cannot ship scripts | Accepted | Supply-chain safety |
| D-14 | Hub (phase 2+) is never a source of truth; acts through Artifactory promotion and Bitbucket PRs | Accepted | Hub outage does not affect developers |
| D-15 | Telemetry comes only from scripts, contains no content, uses hashed identifiers, and is `anonymous` (no user identifier) by default, subject to DPO agreement | Accepted | Reliability and privacy |
| D-16 | MVP targets Kilo Code only, behind an adapter interface | Accepted | Focus; extensibility preserved |
| D-17 | Ship in a single push before merge: code + docs refresh + archived topic in the same PR | Accepted | Avoids pushing to a branch already merged and deleted; "archived" means "submitted in a PR" |
| D-18 | Confluence publishing is one-way (repository → Confluence) with conflict detection | Accepted | Avoids two competing sources of documentation |
| D-19 | Credentials live in `~/.config/kilo/teamflow.credentials` (JSON, user-only permissions) or `TEAMFLOW_*` env vars, never in repositories; exact Kilo configuration folder confirmed in WP-02 | Accepted | Kept next to Kilo's own configuration; prevents token leaks through git |
| D-20 | Skill names: router `teamflow`, all others prefixed `tf-` (agents `tf-agent-`) | Accepted | Avoids collisions with other skills installed in the organization (e.g. a generic `review` or `pr-review`); groups TeamFlow skills together in the `/` menu; short to type |
| D-21 | A dedicated read-only `tf-explain` skill answers code questions | Accepted | Clear routing target; guaranteed no file changes |
| D-22 | MVP scope = foundation + marketplace; Hub in phase 2, telemetry/stats in phase 3, governance in phase 4 | Accepted | Value first; Hub depends on packs existing |
| D-23 | CI for the marketplace is Jenkins | Accepted | Organization standard with Bitbucket DC |
| D-24 | Skill content and specifications are written in English; conversations follow the user's language; generated artifacts follow `project.language` | Accepted | Shareable standard; local teams keep their language |
| D-25 | Scripts are TypeScript on Node.js ≥ 20, bundled per script with esbuild; third-party libraries allowed only if bundled | Accepted | Simplest option: the Jira client and its tests already exist; built-in `fetch`; Python is often absent from corporate Windows workstations and lacks YAML in its standard library |
| D-26 | All packs are installed globally (user scope, `~/.kilocode/skills/`), never per repository; `sync` offers to switch the global version when a repository locks another one | Accepted | One installation per workstation; nothing agent-specific in repositories |
| D-27 | `state.md` transport: a BA without push rights keeps it local and Jira carries it (attached with the spec files); `tf-jira pull` restores it; developers commit it with each commit on the topic branch; at ship time it is archived in `teamflow/changes/archive/<topic>/` and the final version is re-attached to Jira | Accepted | Works for roles without git push; full history kept with the code |
| D-28 | The permanent routing rule is registered only in Kilo's global configuration, by the bootstrap installer | Accepted | Consistent with D-26; nothing to commit per repository |
| D-29 | The Kilo `chat.message` plugin is part of the MVP, built with the mechanism confirmed in WP-02 | Accepted | More reliable routing (Jira keys, agent keywords, active topic, lockfile mismatch) |
| D-30 | Sub-agents: parallel isolated contexts when Kilo supports them, sequential execution in the main session otherwise | Accepted | Works with whatever Kilo offers |
| D-31 | The bootstrap offers to auto-approve TeamFlow scripts in Kilo; external writes stay confirmed by the skills | Accepted | Avoids an approval click per script call without weakening the human gates |
| D-32 | Pack ownership: native Bitbucket DC code owners / default reviewers per path when available, otherwise `OWNERS.yml` + a Jenkins stage blocking merges without owner approval | Accepted | Works on any Bitbucket DC version |
| D-33 | Checkmarx target is CxSAST (on-premise); SonarQube and CxSAST are accessed with personal read-only tokens | Accepted | Per-user audit trail; matches the organization's Checkmarx edition |
| D-34 | Jira Epic linking mode (Epic Link custom field vs `parent`) is detected per project by `tf-jira doctor`; a sandbox project `TFSANDBOX` is used for tests | Accepted | The organization's Jira configuration is not known in advance |
| D-35 | Mermaid diagrams are published to Confluence as code blocks with a link to the repository's HTML diagrams | Accepted | No dependency on a Confluence app |
| D-36 | Artifactory release repository allows anonymous read on the internal network; per-user token only as fallback | Accepted | Simplest bootstrap |
| D-37 | Hub = ASP.NET Core Web API + single-page application | Accepted | Product owner's choice; SPA framework, database, hosting and SSO decided at the start of phase 2 |
| D-38 | Governance: the platform team owns `teamflow-core` and `official` packs; the product owner drives the backlog; releases every two weeks during the pilot, then monthly; support through a chat channel and a Jira project `TEAMFLOW` | Accepted | Clear ownership for an organization-wide standard |
| D-39 | Pilot: one team with an existing .NET microservice on Bitbucket DC + Jira; evaluation fixture: a small .NET 8 "stock" API in `evals/fixtures/` | Accepted | Matches the organization's main stack |
| D-40 | Each TeamFlow skill is written after reviewing, with the product owner, the existing internal skills it replaces (internal content is shared during the work, not stored in this repository) | Accepted | The internal project (same origin, with modified and added skills) cannot be shared as a whole |

## 2. Items still to confirm

| ID | Item | How it is resolved | Owner | Needed by |
|---|---|---|---|---|
| V-01 | Kilo: exact user skills folder, frontmatter fields honored, explicit-only invocation mechanism | WP-02 spike; fallback: description prefix ([03 §3.1](03-agent-adapters.md)) | Tech lead | WP-02 |
| V-02 | Kilo: exact location and format of the global rule; global configuration folder (for D-19 and D-28) | WP-02 spike | Tech lead | WP-02 |
| V-03 | Kilo: `chat.message` behavior (fires on every message? how to add context?) | WP-02 spike; result drives WP-11 | Tech lead | WP-02 |
| V-04 | Kilo: isolated sub-agents and command auto-approval configuration | WP-02 spike | Tech lead | WP-02 |
| V-05 | Bitbucket DC version: native code owners per path available? | Platform team answer | Platform team | WP-13 |
| V-06 | CxSAST server version and REST endpoints for scan results per project/branch | Platform team answer + WP-10 contract tests | Platform team | WP-10 |
| V-07 | Confluence target space and parent page; Jira sandbox `TFSANDBOX` creation | Platform team | Platform team | WP-07 / WP-12 |
| V-08 | Hub: SPA framework, database, hosting, SSO protocol and identity provider | Decision at the start of phase 2 | Platform team | Phase 2 |
| V-09 | DPO agreement on telemetry fields, retention (proposal: raw events 90 days) and legal basis | DPO review | Product owner | Phase 3 |
