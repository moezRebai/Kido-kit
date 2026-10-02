# 12 — Reusable code in this repository

This repository already contains tested TypeScript (Node.js ≥ 20, esbuild bundling, `node --test`,
zero runtime dependencies) that MUST be reused as the foundation of TeamFlow scripts rather than
rewritten. Paths below are relative to this repository's root.

## 1. Reuse as-is (move into `src/` of the TeamFlow source, rename identifiers only)

| Path | What it provides | Used by |
|---|---|---|
| `src/jira/client.ts` | Fetch-based Jira REST client: Cloud (`/rest/api/3`, Basic) and Server/DC (`/rest/api/2`, Bearer); create/update issues; component, priority and sprint resolution with warn-and-skip; child search (Cloud `/search/jql` cursor pagination, DC `POST /search`); attachments upload/delete/download; transitions; TLS opt-out scoped per request | `jira.mjs` |
| `src/jira/adf.ts` | Markdown ↔ Atlassian Document Format | `jira.mjs` (Cloud) |
| `src/jira/wiki.ts` | Markdown ↔ Jira wiki markup | `jira.mjs` (DC) |
| `src/jira/markdown-blocks.ts` | Shared Markdown block/inline parser | Jira converters, new Confluence storage converter |
| `src/lib/tasks-parser.ts` | Parses `## Task N: <title>` sections; title/body extraction | `jira.mjs`, `state.mjs`, `tf-planify` validation |
| `src/lib/fs-utils.ts` | `ensureDir`, `moveDir`, `copyDirContents`, `kebabCase` | Most scripts |
| `src/lib/checkbox.ts`, `src/lib/prompt.ts` | Interactive prompts incl. a Windows stdin fix | Bootstrap installer, `tf-packs doctor --setup` |
| `test/*.test.ts` fake-server tests for Jira | Testing pattern and fixtures | All integration script tests |

## 2. Reuse with changes

| Path | Change |
|---|---|
| `src/commands/jira-sync.ts` | Becomes `jira.mjs sync`. Apply the MUST fixes in [09 §2.3](09-atlassian-integrations.md): write each key immediately, insert by task number, upload-then-delete attachments, recover by label search, add `teamflow` label; add DC Epic Name / Epic Link handling; read/write `state.md` |
| `src/commands/jira-pull.ts` | Becomes `jira.mjs pull`; also creates `state.md` with phase `implement` |
| `src/jira/credentials.ts` | Read `~/.config/kilo/teamflow.credentials` + `TEAMFLOW_*` env vars; multi-service; 0600 file permissions; masked input |
| `src/lib/frontmatter.ts` | Flat parser kept for simple files; nested YAML (`state.md`, `config.yml`, manifests) uses a bundled YAML library |
| `src/pipeline/renderers/types.ts`, `registry.ts`, `kilo-code.ts`, `claude-code.ts`, `gemini-cli.ts` | Generalized into the adapter interface of [03](03-agent-adapters.md); the Kilo renderer currently writes **commands**, it must write **skills** (Kilo supports skills with auto-invocation) |
| `src/skills-content/*.ts` | Prompt bodies of the previous pipeline stages. Mine them for content when writing `tf-specify`, `tf-planify`, `tf-implement`, `tf-review`, `tf-archive`, `tf-document`; then delete — skills become Markdown files, not TypeScript strings |
| `build.js` | Extended: one bundle per script, copy shared references into skills, produce pack archives |

## 3. Not reused

| Path | Reason |
|---|---|
| `src/cli.ts`, `src/lib/args.ts`, `bin/` | No global CLI: each script has its own small argument parser (reuse the parsing approach of `args.ts`) |
| `src/commands/init.ts`, `init-agents.ts`, `new-change.ts`, `status.ts`, `validate.ts`, `archive.ts`, `docs-export.ts` | Replaced by skills plus `state.mjs` and `tf-packs` |
| `src/lib/banner.ts` | Cosmetic CLI banner |
| `src/lib/change-meta.ts`, `src/lib/artifacts.ts`, `src/lib/docs-copy.ts`, the repository path helper in `src/lib/` | Superseded by `state.md` and the new `teamflow/` layout |

## 4. Known defects to fix while porting

Found during review of the existing code; each MUST have a regression test:

1. Story keys written to `tasks.md` only after the whole loop → duplicates after a mid-run failure.
2. Key marker inserted by title regex → wrong task when titles repeat.
3. Attachment deleted before the replacement upload → spec can be lost on failure.
4. Credentials file written without restrictive permissions and not added to the target repo's `.gitignore`.
5. `--type` and change names not validated (path traversal through `../` possible).
6. DC Epic creation without *Epic Name* and Story linking via `parent` instead of *Epic Link*.
7. Lockfile license field mismatch in `package-lock.json` (`UNLICENSED` vs `MIT`) — regenerate.
