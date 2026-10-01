# 15 — Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NF-01 | Security | Packs are a software supply chain: reviewed, scanned (SonarQube, Checkmarx, secrets), immutable once released, SHA-256 verified on install ([10 §9](10-marketplace-and-packs.md)) |
| NF-02 | Security | Credentials only in `~/.config/kilo/teamflow.credentials` (0600 / user-only ACL) or `TEAMFLOW_*` env vars; personal tokens only; never logged, never in reports, never in telemetry |
| NF-03 | Security | TLS verification on by default; internal CA through `tls.caFile`; `allowInsecure` warns on every call and can be forbidden by org policy |
| NF-04 | Security | Scripts validate all inputs used in paths (topic ids `^[a-z0-9][a-z0-9-]{1,79}$`, no `..`, no absolute paths from user input) |
| NF-05 | Security | Skill prompts never instruct the agent to send repository content to any destination other than the configured Jira/Bitbucket/Confluence/SonarQube/Checkmarx/Artifactory hosts |
| NF-06 | Privacy | Telemetry as specified in [11 §4](11-hub-and-telemetry.md): no content, hashed identifiers, `anonymous` by default (no user identifier), subject to DPO agreement |
| NF-07 | Performance | The Kilo plugin completes in < 50 ms per message and makes no network call |
| NF-08 | Performance | Read-only scripts (`state get`, `packs list` from cache, `resolve`) complete in < 1 s on a typical laptop |
| NF-09 | Performance | Integration scripts use timeouts (30 s per request), retry idempotent GETs twice with backoff, and respect `Retry-After` |
| NF-10 | Reliability | Every write to local files is atomic (temp file + rename); every external write is idempotent ([09](09-atlassian-integrations.md)) |
| NF-11 | Reliability | Any topic can be resumed in a new session or on another machine from `state.md` and the topic files alone |
| NF-12 | Offline | Grooming, spec, planning, implementation and review work without network; integrations and `tf-packs` fail with a clear message and no partial state |
| NF-13 | Portability | Windows 10/11 and Linux supported, macOS best effort; scripts use Node APIs only (no Bash/PowerShell syntax), handle path separators and CRLF |
| NF-14 | Portability | Node.js ≥ 20; no `npm install` on workstations |
| NF-15 | Compatibility | Semantic versioning for packs and for the canonical skill format; `teamflow` compatibility ranges enforced by `tf-packs` |
| NF-16 | Observability | Scripts log to `~/.teamflow/logs/<script>.log` (rotated at 5 MB, 3 files), without secrets; `--verbose` prints HTTP method, URL path and status |
| NF-17 | Usability | Every gate states what will happen next and how to decline; error messages say what failed and how to fix it |
| NF-18 | Internationalization | Skill instructions in English; the agent converses in the user's language; generated artifacts in `project.language` |
| NF-19 | Accessibility (Hub, phase 2+) | WCAG 2.1 AA |
| NF-20 | Maintainability | Unit test coverage ≥ 80 % for scripts; every fixed defect gets a regression test |
