# Component / Criticality / Sprint on task Stories

## Problem

`kido jira sync` creates a Jira Story per `## Task N:` section in `tasks.md`, but only
sets `summary`, `description`, and (optionally) `parent`. There's no way to set a
Story's Component, Priority ("Criticality"), or Sprint from Kido — those have to be
set by hand in the Jira UI after the fact, for every task, every time.

## Goals

- A BA/Dev can optionally specify Component, Criticality (Jira's standard Priority
  field), and Sprint per task while breaking work down in `/kido:tasks`.
- `kido jira sync` sets these on the created (or updated, on re-sync) Story.
- An unresolvable value (component/sprint that doesn't exist in this Jira instance)
  warns and is skipped — it never blocks the rest of the sync.
- Works identically on Jira Cloud and Server/Data Center (component/priority are
  standard fields on both; sprint uses Jira Software's Agile REST API, which is
  versioned independently of `/rest/api/{2,3}` and identical on both deployment
  types).

## Non-goals

- Epics, feature-Stories (`functional-spec.md` under an existing Epic), and
  `bug.md` are untouched — they're free-form grilled documents with no fixed
  per-field template, unlike `tasks.md`'s rigid `## Task N:` sections. Extending
  those would mean changing the `/kido:specify` interview itself, which is a
  separate, larger piece of work.
- No fuzzy sprint-name matching — a task's `**Sprint:**` value must exactly match
  (case-insensitively) a real sprint's name on the project's Scrum board. No
  partial/substring matching, no "closest match" heuristics.
- No multi-component support — one component name per task, not a list.
- If a project has more than one Scrum board, only the first one Jira's Agile API
  returns is searched for a matching sprint. (Most projects have exactly one.)

## Design

### `tasks.md` template (`src/skills-content/tasks.ts`)

The per-task template gains three new **optional** lines after `**Test:**`:

```
## Task 1: <short title>

<task body>

**Depends on:** none | Task <n>[, Task <m>...]
**Test:** <the acceptance check / test that should pass>
**Component:** <Jira component name>
**Criticality:** <Jira priority name, e.g. High>
**Sprint:** <Jira sprint name>
```

The skill's instructions tell the agent to ask the BA once per task, alongside the
existing dependency/test questions, whether they want to set a Component,
Criticality, or Sprint — same "ask, don't force a form" grilling style as the rest
of `/kido:tasks`. Any of the three can be left unanswered; the line is simply
omitted (never written as `**Component:** (none)` or similar). These lines stay in
the description text on Jira, exactly like `**Depends on:**`/`**Test:**` already
do — no stripping.

### Parsing (`src/commands/jira-sync.ts`)

Three new line-regexes, same pattern as the existing `JIRA_LINE`:

```ts
const COMPONENT_LINE = /^\*\*Component:\*\*\s*(.+)$/m;
const CRITICALITY_LINE = /^\*\*Criticality:\*\*\s*(.+)$/m;
const SPRINT_LINE = /^\*\*Sprint:\*\*\s*(.+)$/m;
```

`syncTasksAsStories` extracts these (trimmed) from `task.body` — same source text
the description is already built from — and passes them through to
`createIssue`/`updateIssue` as new optional fields. Nothing else in `jira-sync.ts`
changes; Epics/feature-Stories/Bugs never read these lines.

### `JiraClient` (`src/jira/client.ts`)

`JiraIssueInput` gains three optional fields:

```ts
export interface JiraIssueInput {
  summary: string;
  description: string;
  issueType: JiraIssueType;
  parentKey?: string;
  component?: string;
  priority?: string;
  sprintName?: string;
}
```

`updateIssue`'s accepted fields widen from `Pick<JiraIssueInput, "summary" |
"description">` to also include `"component" | "priority" | "sprintName">` — a
re-sync updates these fields too, matching Kido's existing "sync reflects current
tasks.md state" semantics.

**Resolution before create/update** (both `createIssue` and `updateIssue` share
this): each of `component`/`priority`/`sprintName`, if present, is validated
*before* being included in the Jira API call — Jira's issue create/update is
atomic, so an invalid value inside the same request would fail the whole request,
not just that field. Validation:

- **Component**: fetched once per `JiraClient` instance via `GET
  {apiBase}/project/{projectKey}/components`, cached. If the given name matches
  (case-insensitive) one of the project's components, `fields.components =
  [{ name: <matched-name> }]`. Otherwise: `console.warn` naming the task/value,
  field omitted.
- **Criticality → Priority**: fetched once per instance via `GET {apiBase}/priority`
  (Jira's standard priority scheme, same shape on Cloud and Server/DC), cached. If
  the given name matches (case-insensitive), `fields.priority = { name: <matched-name> }`.
  Otherwise: warn, omitted.
- **Sprint**: see below — a multi-step resolution, warn+omit if any step fails to
  find a match.

**Sprint resolution** (new private methods on `JiraClient`):

1. Find the Sprint custom field's ID — `GET {apiBase}/field`, find the entry whose
   `schema.custom` is `"com.pyxis.greenhopper.jira:gh-sprint"` (Jira Software's
   fixed type identifier for the Sprint field, same on Cloud and Server/DC). Cached
   once per `JiraClient` instance (`Promise<string | undefined>`, memoized even if
   `undefined` — a project without Jira Software/Agile has no such field, and
   every sprint request thereafter should skip straight to "not found" without
   re-querying).
2. Find a Scrum board for `this.creds.projectKey` — `GET /rest/agile/1.0/board?projectKeyOrId=<projectKey>&type=scrum`,
   take the first result. Cached once per instance.
3. List that board's sprints — `GET /rest/agile/1.0/board/{boardId}/sprint`
   (no state filter — searches active, future, and closed sprints), find one whose
   `name` matches the given `sprintName` case-insensitively.
4. If the field ID, board, or matching sprint aren't found at any step: warn (naming
   which step failed) and omit the field. If all three resolve:
   `fields[sprintFieldId] = <matched sprint's id, a number>`.

The Agile REST API (`/rest/agile/1.0/...`) is a separate base path from
`{apiBase}` (`/rest/api/2` or `/rest/api/3`) — it's versioned independently by
Atlassian and identical on Cloud and Server/DC, so no `deploymentType` branching is
needed for it. Requests go through the same `authHeader()`/`withTlsEnv` machinery
as everything else.

### Error handling

Every warn-and-skip case prints one `console.warn` line naming the task title, the
field, and the value that couldn't be resolved (e.g. `Warning: Task "Add
calculator": Sprint "Sprnt 42" not found on the project's board — skipping.`).
Sync continues and still creates/updates the Story with every other field.

## Testing

- `src/skills-content/tasks.ts`: no automated test (it's prompt content, like the
  rest of that file today).
- `test/jira-sync.test.ts`: extended with cases covering — a task with a valid
  Component/Criticality/Sprint all resolving correctly; a task with an
  unresolvable Component (warns, Story still created without it); a task with no
  Sprint field configured on the fake project at all (warns, skipped cleanly); a
  re-sync (update) that changes a task's Criticality and confirms the update call
  reflects it.
- The existing fake Jira server in `jira-sync.test.ts` gains routes for `GET
  /project/:key/components`, `GET /priority`, `GET /field`, `GET
  /rest/agile/1.0/board`, and `GET /rest/agile/1.0/board/:id/sprint`.

## Open questions

None — scope, value source, field mapping, error handling, and matching rules
were all confirmed interactively before writing this spec.
