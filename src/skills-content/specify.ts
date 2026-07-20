import type { PipelineStage } from "../pipeline/definition.js";

const body = `Start or continue a change. This is the single entry point for both BA and Dev — it figures out what stage you're actually at and picks up from there.

**Store selection:** resolve the repo root (walk up for \`kido/\`). If the user says they don't have a change name yet, ask what they want to build/fix.

**If \`kido/docs/\` is empty or missing**, don't draft anything blind — check whether this repo already has real application code (anything beyond \`kido/\`, \`.claude/\`, and typical repo scaffolding like \`package.json\`/\`.git\`, via \`Glob\`):

- **Code already exists (brownfield, docs just haven't been built yet)** → stop, redirect to \`/kido:document\` first. There's something real to discover; that's its job, not this one.
- **No real code yet (genuinely greenfield)** → don't redirect. Build \`kido/docs/\` yourself, right now, as the first part of this session — see "Building docs for a greenfield project" below. Once it's in place, continue straight into Step 1 using what you just established.

### Building docs for a greenfield project

There's nothing to read, so this is an interview instead of an extraction — adapt the \`grill-with-docs\` pattern (relentless-but-collaborative interview that produces documentation as it goes):

- **Adaptive flow, not a script:** product vision/why → core capabilities → target architecture/tech stack → conventions. Open threads, not a checklist interrogation.
- **Draft ADRs live.** The moment a real architectural decision crystallizes ("we'll use X for Y, because Z"), write that ADR into \`technical-docs.md\` immediately — don't batch it for later.
- **One-sided sessions are fine.** If only Dev is present, \`technical-docs.md\` gets richer than \`functional-docs.md\` — mark the thin sections as open questions rather than fabricating BA content. This is repeatable, not one-shot; run it again later to fill gaps.
- **Termination:** hybrid. Propose "I think we have enough for a first version" once the templates' required sections are covered, but the user can always say "keep going" or "stop now, generate what we have."
- **Seeded from a legacy repo?** If \`kido docs export --to <this-repo>\` was already run (or the user says yes to "do you have legacy docs to seed from?" at \`kido init\`), you'll find a copy of the legacy project's docs already sitting in \`kido/docs/\`. Treat that as reference material, not the final output: go through it section by section with the user, deciding what carries over unchanged (business rules usually do) vs. what needs rewriting for the new stack (architecture specifics usually don't). A human stays in the loop on what survives — don't silently strip or keep anything. Emit the adapted \`functional-docs.md\`/\`technical-docs.md\` for *this* repo when done.

## Step 1 — Bug or feature?

This is the actual first fork of the whole pipeline. Ask if it isn't already obvious from what the user said.

- **Bug** → skip to "Bug path" below.
- **Feature** → continue to Step 2.

## Step 2 — Feature path: one session, both specs

Run \`kido status --change <name>\` (creating the change with \`kido new-change <name> --type feature\` first if it doesn't exist yet). Unlike the rest of the pipeline, this isn't a multi-invocation dispatch — a single \`/kido:specify\` run walks straight through **both** \`functional-spec.md\` and \`design.md\` back to back, in this order, before finishing:

- **Neither exists yet** → do the full sequence below: functional-spec grilling, then design grilling, in the same sitting.
- **\`functional-spec.md\` exists, no \`design.md\`** → skip straight to design grilling (someone already did the functional pass in an earlier session; pick up where they left off).
- **Both exist** → nothing left for this command; point the user at \`/kido:tasks\`.

BA doesn't need Dev to be in the room for this. If Dev genuinely isn't present, **draft \`design.md\` yourself** using your own technical judgment — still through the full grilling rigor below (including the boundary/failure/concurrency enumeration), not a shortcut version. Mark the parts you're least confident about as needing Dev validation, but don't block on it — Dev can review and amend \`design.md\` later, asynchronously, same as they'd review any other draft. If Dev *is* present, obviously let them drive the technical-approach questions.

**Dev-only entry** (starting directly at \`design.md\` with no \`functional-spec.md\` at all) is only appropriate for genuinely non-business-facing internal/infra work — a dependency bump, an internal refactor with zero user-facing behavior change. It is NOT appropriate for feature work, page rewrites, or migrations, even when "the code already existed before" — anything with functional/business meaning should still get a (possibly lightweight) functional-spec.md first, because that's what makes the Jira Epic and keeps intent traceable. If you're unsure which bucket a request falls into, ask.

### Functional-spec grilling

Adapt Superpowers' \`brainstorming\` mechanics:
- One question at a time. Multiple-choice preferred over open-ended.
- Read \`kido/docs/{project}-functional-docs.md\` first, so you don't propose something that contradicts an already-documented capability.
- Focus questions on: business problem/why now, users affected, user stories/scenarios (Given/When/Then, since these need to map to Jira Stories later via \`/kido:tasks\`), acceptance criteria, explicit out-of-scope/non-goals.
- **Before considered done:** explicitly enumerate boundary, failure, and concurrent-access conditions relevant to this change — even if the answer for some is "not applicable, because X." Don't let a challenging-question pass substitute for this being written down as its own reviewed section.
- Once you understand it, present the draft \`functional-spec.md\` in sections, get approval section-by-section.
- Self-review before finalizing: any placeholders/TBDs, internal contradictions, scope creep, or ambiguous requirements? Fix inline.
- Write \`functional-spec.md\` to \`kido/changes/<name>/\`.
- Then continue straight into design grilling below — don't stop and wait for a separate invocation.

### Design grilling

Same brainstorming mechanics, different inputs and content:
- Read \`functional-spec.md\` (just written, or from an earlier session) + \`kido/docs/{project}-technical-docs.md\` (target architecture, existing conventions, prior ADRs).
- Propose 2-3 technical approaches with tradeoffs, lead with your recommendation.
- Cover in the draft: chosen approach (+ alternatives considered and why rejected), architecture impact (affected components, new ones introduced), data model/contract changes (schemas, shared DTOs, API endpoints, streaming events), testing strategy (TDD — what's unit vs. integration), risks & mitigations.
- **Before considered done:** same boundary/failure/concurrent-access enumeration as the functional-spec pass, now at the technical level — e.g. what happens at data-model boundaries, on partial failure, under concurrent writes/requests. Write it down explicitly, don't leave it implicit in "risks & mitigations."
- If this design makes a real architectural decision, draft a new ADR entry directly into \`technical-docs.md\` (don't wait for \`/kido:document\` to run again).
- Section-by-section approval, then self-review, then write \`design.md\`.
- **Once both files are written, ask once** (don't auto-push): "Want me to push this to Jira as an Epic? (Or if you already created it manually, give me the key and I'll link to it instead.)"
  - **They give you an existing key** (e.g. they hit this before — no Jira credentials configured yet — and made the Epic by hand as a stopgap): write \`jiraId: <key>\` into \`functional-spec.md\`'s frontmatter yourself (\`design.md\` doesn't need its own — the Epic sync always reads the key from \`functional-spec.md\`). Do this *before* ever running \`kido jira sync\` for this change — otherwise the next sync has no way to know the Epic already exists and creates a duplicate.
  - **They say yes, create it**: run \`kido jira sync --change <name>\` — it pushes \`functional-spec.md\` and \`design.md\` together into the same Epic's description (two labeled sections; Jira's hierarchy has no separate tier for design.md).
  - **They decline, or \`kido jira sync\` fails because credentials aren't configured**: that's fine, don't block — the files are already safely written locally. Tell them they can configure credentials later and just re-run \`kido jira sync --change <name>\` (safe/idempotent), or create the Epic manually now and come back to record its key the way described above.

## Bug path

Same grilling rigor as the functional-spec pass above, scoped to \`bug.md\`'s content. Still no \`design.md\`/\`tasks.md\` — one document, fully grilled:

- Description of the bug and, if the user has it, a reproduction scenario/steps.
- **Before considered done:** explicitly enumerate the boundary, failure, and concurrent-access conditions relevant to the bug — is it reproducible only under specific input/timing/state, does it affect concurrent users, are there adjacent cases likely to share the same root cause? Even "not applicable, because X" counts, but it has to be written down.
- Present section-by-section, get approval, self-review before finalizing (same discipline as functional-spec.md).
- Write \`bug.md\` to \`kido/changes/<name>/\` (create the change with \`kido new-change <name> --type bug\` if needed).
- **Ask**: "Want me to push this to Jira as a Bug ticket? (Or if you already created it manually, give me the key and I'll link to it instead.)" Existing key given → write \`jiraId: <key>\` into \`bug.md\`'s frontmatter before ever syncing, same reasoning as the Epic case above. Yes, create it → run \`kido jira sync --change <name>\`. Declined or not configured → fine, files stay local, don't block.
- Point the user at \`/kido:apply\`-adjacent flow next: for bugs, that means reproduce with a failing unit test, then fix — not the multi-task subagent dispatch \`/kido:apply\` uses for features (see that skill's guardrails).

## Guardrails

- Never silently sync to Jira — always ask first, every time.
- If the user says they already created the Jira Epic/Bug by hand (e.g. no credentials configured at the time), always record its key in the relevant file's \`jiraId\` frontmatter *before* ever running \`kido jira sync\` for that change — idempotency is keyed off that local frontmatter value, not anything looked up in Jira, so skipping this creates a duplicate ticket the first time sync does run.
- Don't skip the grilling phase for functional-spec.md, design.md, or bug.md, even for "simple" changes — that's exactly where unexamined assumptions cause the most rework.
- Don't skip the boundary/failure/concurrent-access enumeration either — it's a required part of "done," not an optional nicety.
- If \`kido/docs/\` is missing and this repo has existing code, stop and redirect to \`/kido:document\` — don't draft anything ungrounded. If there's no existing code, build \`kido/docs/\` yourself first (see above) instead of redirecting.
`;

export const specifyStage: PipelineStage = {
  id: "specify",
  description:
    "Start a change — forks bug vs feature, then in one session walks through functional-spec.md AND design.md (or bug.md) via a brainstorming-style grilling session requiring enumerated boundary/failure/concurrent-access conditions. BA can run this solo (drafting design.md itself if Dev isn't present) since Jira, not git, is how the result reaches Dev. For a greenfield repo with no kido/docs/, builds it inline first. The main entry point for new work.",
  allowedTools: "Bash(kido:*), Read, Write, Edit, Glob, AskUserQuestion",
  body,
};
