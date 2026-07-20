import type { PipelineStage } from "../pipeline/definition.js";

const body = `Start or continue a change. This is the single entry point for both BA and Dev — it figures out what stage you're actually at and picks up from there.

**Store selection:** resolve the repo root (walk up for \`kido/\`). If \`kido/docs/\` is empty or missing, stop and redirect to \`/kido:study\` first (greenfield or brownfield mode as appropriate) — don't draft specs blind. If the user says they don't have a change name yet, ask what they want to build/fix.

## Step 1 — Bug or feature?

This is the actual first fork of the whole pipeline. Ask if it isn't already obvious from what the user said.

- **Bug** → skip to "Bug path" below. No grilling ceremony, no functional-spec/design/tasks.
- **Feature** → continue to Step 2.

## Step 2 — Feature path: which pass are we in?

Run \`kido status --change <name>\` (creating the change with \`kido new-change <name> --type feature\` first if it doesn't exist yet). Dispatch on what exists:

- **No \`functional-spec.md\` yet** → this is the BA pass. Go to "Functional-spec grilling" below.
- **\`functional-spec.md\` done, no \`design.md\`** → this is the Dev pass. Go to "Design grilling" below.
- **Both done** → nothing left for this command; point the user at \`/kido:tasks\`.

**Dev-only entry** (starting directly at \`design.md\` with no \`functional-spec.md\`) is only appropriate for genuinely non-business-facing internal/infra work — a dependency bump, an internal refactor with zero user-facing behavior change. It is NOT appropriate for feature work, page rewrites, or migrations, even when "the code already existed before" — anything with functional/business meaning should still get a (possibly lightweight) functional-spec.md first, because that's what makes the Jira Epic and keeps intent traceable. If you're unsure which bucket a request falls into, ask.

### Functional-spec grilling (BA)

Adapt Superpowers' \`brainstorming\` mechanics:
- One question at a time. Multiple-choice preferred over open-ended.
- Read \`kido/docs/{project}-functional-docs.md\` first, so you don't propose something that contradicts an already-documented capability.
- Focus questions on: business problem/why now, users affected, user stories/scenarios (Given/When/Then, since these need to map to Jira Stories later via \`/kido:tasks\`), acceptance criteria, explicit out-of-scope/non-goals.
- Once you understand it, present the draft \`functional-spec.md\` in sections, get approval section-by-section.
- Self-review before finalizing: any placeholders/TBDs, internal contradictions, scope creep, or ambiguous requirements? Fix inline.
- Write \`functional-spec.md\` to \`kido/changes/<name>/\`.
- **Ask** (don't auto-push): "Want me to push this to Jira as an Epic?" If yes, run \`kido jira sync --change <name>\`.

### Design grilling (Dev)

Same brainstorming mechanics, different inputs and content:
- Read \`functional-spec.md\` (if present) + \`kido/docs/{project}-technical-docs.md\` (target architecture, existing conventions, prior ADRs).
- Propose 2-3 technical approaches with tradeoffs, lead with your recommendation.
- Cover in the draft: chosen approach (+ alternatives considered and why rejected), architecture impact (affected components, new ones introduced), data model/contract changes (schemas, shared DTOs, API endpoints, streaming events), testing strategy (TDD — what's unit vs. integration), risks & mitigations.
- If this design makes a real architectural decision, draft a new ADR entry directly into \`technical-docs.md\` (don't wait for \`/kido:study\` to run again).
- Section-by-section approval, then self-review, then write \`design.md\`.

## Bug path

No grilling ceremony — just capture what's known:
- Description of the bug and, if the user has it, a reproduction scenario/steps.
- Write \`bug.md\` to \`kido/changes/<name>/\` (create the change with \`kido new-change <name> --type bug\` if needed).
- **Ask**: "Want me to push this to Jira as a Bug ticket?" If yes, run \`kido jira sync --change <name>\`.
- Point the user at \`/kido:apply\`-adjacent flow next: for bugs, that means reproduce with a failing unit test, then fix — not the multi-task subagent dispatch \`/kido:apply\` uses for features (see that skill's guardrails).

## Guardrails

- Never silently sync to Jira — always ask first, every time.
- Don't skip the grilling phase for either functional-spec.md or design.md, even for "simple" changes — that's exactly where unexamined assumptions cause the most rework.
- If \`kido/docs/\` is missing, stop and redirect to \`/kido:study\` — don't draft anything ungrounded.
`;

export const specStage: PipelineStage = {
  id: "spec",
  description:
    "Start or continue a change — forks bug vs feature, then walks BA through functional-spec.md and/or Dev through design.md via a brainstorming-style grilling session. The main entry point for new work.",
  allowedTools: "Bash(kido:*), Read, Write, Edit, AskUserQuestion",
  body,
};
