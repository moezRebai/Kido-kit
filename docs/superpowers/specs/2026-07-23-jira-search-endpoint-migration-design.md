# Jira search endpoint migration (fix `kido jira pull` on Epics)

## Problem

`kido jira pull <EPIC-KEY>` fails with `Jira API error 410` when pulling a feature Epic:

```
Jira API error 410: {"errorMessages":["L'API demandée a été supprimée. Veuillez migrer vers l'API
/rest/api/3/search/jql. ..."],"errors":{}}
```

Atlassian removed the legacy `GET /rest/api/3/search` endpoint. `JiraClient.searchChildIssues`
(`src/jira/client.ts:134-153`) — used by `jira-pull.ts`'s `materializeFeature` to reconstruct
`tasks.md` from an Epic's child Stories — is the only call site in kido that hits it. `getIssue`,
`createIssue`, `updateIssue`, and `transitionToStatus` all use unaffected endpoints and are not
part of this fix.

## Fix

Migrate `searchChildIssues` to `GET /rest/api/3/search/jql`, looping on cursor-based pagination:

- Same `jql` construction (`parent = <epicKey> ORDER BY created ASC`) and `fields` param — JQL
  syntax and query-param shape are unchanged, only the path and pagination model changed.
- The new endpoint returns `nextPageToken` (absent/undefined when there's no more data) instead
  of `startAt`/`total`. Loop: request a page, collect its `issues`, and if the response carries a
  `nextPageToken`, request again passing that token; stop once there isn't one.
- This always returns the complete child list regardless of how many Stories are under an Epic,
  rather than silently truncating at one page's worth.

No other files in `src/` reference the old search endpoint (confirmed via grep).

## Test changes

`test/jira-pull.test.ts`'s fake Jira server:

- Change its route from `/rest/api/3/search` to `/rest/api/3/search/jql`, returning
  `{ issues, isLast: true }` (no `nextPageToken`) for the existing single-page test cases — no
  behavior change to those tests otherwise.
- Add one new test with an Epic that has enough child Stories to span two pages, asserting the
  fake server is hit twice via `nextPageToken` and that `runJiraPull` returns every child, in
  order, with none dropped. This is the regression test that would have caught the original 410
  (all existing tests only exercised the ≤1-page case).

## Out of scope

- Adopting `C:\Solutions\Skills\skills\jira` (a Claude-Code skill script) as a runtime dependency
  for kido's Jira client — considered and rejected. That skill is designed for on-demand agent
  invocation (piped JSON, agent-enforced confirm-before-mutating), not for embedding in a
  published, non-interactive CLI; it also reads different credentials
  (`JIRA_*`/`~/.jira-credentials.json` vs kido's per-repo `KIDO_JIRA_*`/`.kido-credentials`) and
  has the same single-page pagination gap this fix addresses. See conversation history for full
  rationale.
- Richer markdown↔ADF round-tripping (the skill's `adf.mjs` supports headings/lists/bold/code/
  links; kido's `client.ts` only round-trips a single plain-text paragraph). Worth a future spec,
  not part of this fix.
