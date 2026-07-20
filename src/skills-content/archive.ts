import type { PipelineStage } from "../pipeline/definition.js";

const body = `Close out a change. This is always the LAST step — never run it before the git/docs steps below.

## Sequence

Once all tasks (or the bug fix) are implemented and reviewed:

0. **Before offering commit/push/PR at all, confirm review actually happened** for every task (or the bug fix) — per \`/kido:apply\`'s process. If it didn't (e.g. you're picking this up in a fresh session and can't confirm it ran), perform the \`/kido:review\` check now rather than assuming it's already done. Don't take "the tasks are implemented" as proof review happened — they're separate steps.
1. **Ask**: "Ready to commit, push, and open a PR?" If yes: commit (referencing the spec/Jira IDs in the message), push, open the PR. If no, stop here — don't archive a change that isn't actually committed.
   - **Stage only the actual application code changes for this commit.** Never include \`kido/changes/\` (the in-flight planning docs) or \`.claude/\` (generated skills/commands, local Claude Code settings) — exclude them by default, without asking. These are tooling/process artifacts, not product code, and mixing them into the feature commit muddies the diff. \`.claude/\` should stay untracked entirely (it's fully regeneratable via \`kido init\` — nothing lost). \`kido/changes/\` gets its own separate commit in step 3 below, once archived — it's not that it never gets committed, just not bundled in with the code.
2. **Ask**: "Want me to update \`kido/docs/\` with anything from this change?" If yes: re-invoke \`/kido:study\` in its scoped, incremental mode — seeded with this change's own artifacts (\`functional-spec.md\`/\`design.md\`/\`tasks.md\`/\`bug.md\` + the actual diff) plus a re-read of just the affected code area. Don't do a full repo rescan for this.
3. Run \`kido archive <name>\` — moves \`kido/changes/<name>/\` to \`kido/changes/archive/<name>/\`. Then commit **just this move** as its own separate commit (e.g. \`docs: archive <name> planning docs\`) — this is what actually gets the functional-spec/design/tasks history into git, kept cleanly apart from the code commit in step 1. If \`/kido:study\` wrote any \`kido/docs/\` updates in step 2, include those in this same commit too (both are docs-only changes).
4. Update the Jira Epic/Story (or Bug) status to reflect completion.

## Guardrails

- Don't skip straight to archiving without asking about commit/PR and \`/docs\` first — the order matters (decision: archive is always last).
- Don't silently update \`/docs\` — always ask.
- If the user says no to commit/PR, don't archive — the change isn't actually done yet, just leave it in \`kido/changes/<name>/\` for later.
- Don't skip the archive commit in step 3 — an archived change that's still just sitting uncommitted in the working tree defeats the point of keeping the planning history in git.
`;

export const archiveStage: PipelineStage = {
  id: "archive",
  description:
    "Close out a finished change — asks about commit/push/PR, asks about updating kido/docs/, then archives the change folder and updates Jira status. Always the last step in the pipeline.",
  allowedTools: "Bash(kido:*), Bash, AskUserQuestion",
  body,
};
