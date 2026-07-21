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

## Step 2 — Feature path: functional-spec, a checkpoint, then design

Run \`kido status --change <name>\` (creating the change with \`kido new-change <name> --type feature\` first if it doesn't exist yet). Dispatch on what exists:

- **Neither exists yet** → functional-spec grilling first. Once it's written, stop at the "Checkpoint" below rather than sliding straight into design grilling — that's the BA/Dev handoff point, and it's explicit now, not silent.
- **\`functional-spec.md\` exists, no \`design.md\`** → skip straight to design grilling. Someone already did the functional pass and either continued through the checkpoint or deliberately stopped there to bring Dev in — either way, pick up where they left off.
- **Both exist** → nothing left for this command; point the user at \`/kido:tasks\`.

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

### Checkpoint — functional done, hand-off point for Dev

Stop here and tell the user plainly: "functional-spec.md is done. Next is the technical design — that's best worked out together with Dev, since it's their call how to build this." Don't just carry on into design grilling silently.

- **Ask**: "Want me to push \`functional-spec.md\` to Jira now, so it's tracked even before the design is written?" If yes, **ask**: "Does this need its own new Epic, or does it belong under an Epic that already exists?"
  - **New Epic** (default): push \`functional-spec.md\` as its own Epic. Same create/link/decline handling as any other Jira push (see Guardrails) — if they already made the Epic by hand, record its key in frontmatter instead of creating a duplicate; if they decline or credentials aren't configured, that's fine, don't block.
  - **Existing Epic**: ask for the key, then write \`epicId: <key>\` directly into \`functional-spec.md\`'s frontmatter yourself, *before* running \`kido jira sync\` — the CLI reads this automatically and syncs \`functional-spec.md\` (+ \`design.md\` later) as a single **Story** nested under that Epic instead of creating a new one. **Only pick this if the whole feature is one unit of work — no task breakdown.** If it'll need multiple tasks, use "new Epic" instead, even if it conceptually belongs to a bigger initiative — task breakdown under a shared existing Epic isn't supported yet.
  - Either way, if \`design.md\` gets added later in a follow-up session, re-running \`kido jira sync\` just updates the same Epic or Story to include it — nothing gets duplicated.
- **Then ask**: "Continue into the design pass now, or stop here and pick it up later with Dev?"
  - **Continue now** → go straight into design grilling below, in this same session.
  - **Stop here** → stop the whole session. \`functional-spec.md\` is saved (and pushed, if that was just answered yes). There's nothing else to do right now — running \`/kido:specify\` again later, whenever Dev's available, will see \`functional-spec.md\` is done and jump straight to design grilling.

### Design grilling

If Dev genuinely isn't present when this is reached (BA chose to continue solo at the checkpoint above), **draft \`design.md\` yourself** using your own technical judgment — still through the full grilling rigor below (including the boundary/failure/concurrency enumeration), not a shortcut version. Mark the parts you're least confident about as needing Dev validation, but don't block on it — Dev can review and amend \`design.md\` later, asynchronously, same as they'd review any other draft. If Dev *is* present, obviously let them drive the technical-approach questions.

Same brainstorming mechanics as the functional pass, different inputs and content:
- Read \`functional-spec.md\` (just written, or from an earlier session) + \`kido/docs/{project}-technical-docs.md\` (target architecture, existing conventions, prior ADRs).
- Propose 2-3 technical approaches with tradeoffs, lead with your recommendation.
- Cover in the draft: chosen approach (+ alternatives considered and why rejected), architecture impact (affected components, new ones introduced), data model/contract changes (schemas, shared DTOs, API endpoints, streaming events), testing strategy (TDD — what's unit vs. integration), risks & mitigations.
- **Before considered done:** same boundary/failure/concurrent-access enumeration as the functional-spec pass, now at the technical level — e.g. what happens at data-model boundaries, on partial failure, under concurrent writes/requests. Write it down explicitly, don't leave it implicit in "risks & mitigations."
- If this design makes a real architectural decision, draft a new ADR entry directly into \`technical-docs.md\` (don't wait for \`/kido:document\` to run again).
- Section-by-section approval, then self-review, then write \`design.md\`.
- **Now that both files are written, sync Jira**:
  - **functional-spec.md was already pushed at the checkpoint** → just run \`kido jira sync --change <name>\` again, no need to ask a second time — it's an update to the same Epic or Story (now with both sections), not a new push. Just tell the user it's done.
  - **It wasn't pushed yet** (declined at the checkpoint, or the checkpoint itself was skipped because both files got written in one uninterrupted flow) → **ask once** (don't auto-push): "Want me to push this to Jira now? (Or if you already created it manually, give me the key and I'll link to it instead.)" then the same new-Epic-vs-existing-Epic choice from the checkpoint applies here too:
    - **They give you an existing key for a ticket they already made**: write \`jiraId: <key>\` into \`functional-spec.md\`'s frontmatter yourself (\`design.md\` doesn't need its own — the sync always reads the key from \`functional-spec.md\`) *before* ever running \`kido jira sync\` — otherwise the next sync has no way to know it already exists and creates a duplicate.
    - **They say yes, new Epic**: run \`kido jira sync --change <name>\` — it pushes \`functional-spec.md\` and \`design.md\` together into the same Epic's description (two labeled sections; Jira's hierarchy has no separate tier for design.md).
    - **They say yes, existing Epic**: write \`epicId: <key>\` into \`functional-spec.md\`'s frontmatter first (same as the checkpoint), then run \`kido jira sync --change <name>\` — syncs both files as a single Story under that Epic.
    - **They decline, or \`kido jira sync\` fails because credentials aren't configured**: that's fine, don't block — the files are already safely written locally. Tell them they can configure credentials later and just re-run \`kido jira sync --change <name>\` (safe/idempotent), or create the ticket manually now and come back to record its key the way described above.
- **If this change is in existing-Epic mode** (\`functional-spec.md\`'s frontmatter has \`epicId\`): don't suggest \`/kido:tasks\` — there's no task breakdown for a single Story. Close out instead: "This is filed as a single Story under [the existing Epic] — Dev picks it up via \`kido jira pull <story-key>\` + \`/kido:apply\` directly, same single-pass implementation as the bug path." Otherwise (new-Epic mode, the default), nothing changes — \`/kido:tasks\` is the natural next step, same as always.

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
- Don't silently slide from functional-spec grilling into design grilling — always stop at the checkpoint and let the user decide whether to continue solo or wait for Dev.
- Don't offer "existing Epic" mode for anything that might need a task breakdown — it's for single-unit-of-work features only. If unsure whether it'll stay small, default to "new Epic."
- Don't skip the boundary/failure/concurrent-access enumeration either — it's a required part of "done," not an optional nicety.
- If \`kido/docs/\` is missing and this repo has existing code, stop and redirect to \`/kido:document\` — don't draft anything ungrounded. If there's no existing code, build \`kido/docs/\` yourself first (see above) instead of redirecting.
`;

export const specifyStage: PipelineStage = {
  id: "specify",
  description:
    "Start a change — forks bug vs feature. Feature path: functional-spec.md grilling, then an explicit checkpoint (push to Jira as a new Epic or under an existing one? continue into design now, or stop and wait for Dev?), then design.md grilling if continuing. Existing-Epic mode files as a single Story with no task breakdown — skips /kido:tasks entirely. Bug path: bug.md via the same grilling rigor. Boundary/failure/concurrent-access conditions must be enumerated for every artifact. For a greenfield repo with no kido/docs/, builds it inline first. The main entry point for new work.",
  allowedTools: "Bash(kido:*), Read, Write, Edit, Glob, AskUserQuestion",
  body,
};
