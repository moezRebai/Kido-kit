import type { PipelineStage } from "../pipeline/definition.js";

const body = `Study this project and (re)build \`kido/docs/\` — the single source of truth every other Kido stage reads from. Never invoked blind: you're always in one of three modes below.

**Store selection:** resolve the repo root by walking up for a \`kido/\` folder (or \`.git\` as a fallback anchor). Everything below is scoped to that root's \`kido/docs/{project}-functional-docs.md\` and \`kido/docs/{project}-technical-docs.md\`.

---

## Mode 1 — Brownfield (existing code, no legacy repo to seed from)

Adapt the project's existing \`discover-and-document\` skill approach as-is — it already does exactly this:

1. **Inventory** — cheap, breadth-first: file tree, stack detection, entry points, existing docs (treat as claims to verify, not truth), repo size → strategy.
2. **Map** — module/component graph, dependency edges, data model, and a deliberate pass over three first-class surface kinds: API surface (request/response), real-time/streaming channels, service topology (discovery & routing).
3. **Deep-dive** — trace 2-4 critical flows end-to-end across module boundaries, extract business rules, spot where names lie about behavior.
4. **Synthesize** — reconcile map vs. reality, reverse-engineer ADRs (mark them explicitly "inferred — please review"), run a verify-before-emit loop.
5. **Emit** — write \`{project}-functional-docs.md\` (capability inventory, use cases/user journeys, business rules, domain glossary, scope/assumptions) and \`{project}-technical-docs.md\` (C4 diagrams, component reference, data model, sequence diagrams, ADRs, cross-cutting concerns, build/run notes). Diagrams inline as Mermaid, not separate files.

**Ground everything.** Every non-trivial claim cites a real file/symbol. Anything unverifiable goes to a "Confidence & open questions" section — never asserted as fact.

**Scoping:** if invoked for a specific area (e.g. from an archive-time refresh, mode 3 below), don't re-scan the whole repo — focus the Map/Deep-dive passes on the affected area, but still validate against the rest for consistency.

## Mode 2 — Greenfield (no code, nothing to seed from)

There's nothing to read, so this is an interview instead of an extraction — adapt the \`grill-with-docs\` pattern (relentless-but-collaborative interview that produces documentation as it goes), not the brainstorming pattern from \`/kido:spec\` (that one's for a single change; this one's for the whole project's knowledge base).

- **Adaptive flow, not a script:** product vision/why → core capabilities → target architecture/tech stack → conventions. Open threads, not a checklist interrogation.
- **Draft ADRs live.** The moment a real architectural decision crystallizes ("we'll use X for Y, because Z"), write that ADR into \`technical-docs.md\` immediately — don't batch it for later.
- **One-sided sessions are fine.** If only Dev is present, technical-docs.md gets richer than functional-docs.md — mark the thin sections as open questions rather than fabricating BA content. Someone can run \`/kido:study\` again later to fill them in; this mode is repeatable, not one-shot.
- **Termination:** hybrid. Propose "I think we have enough for a first version" once the functional-docs.md/technical-docs.md templates' required sections are covered, but the user can always say "keep going" or "stop now, generate what we have."

## Mode 3 — Regeneration (seeding a new repo from a legacy one)

Triggered from \`kido init\` when the user says yes to "do you have legacy docs to seed from?" (decision #59), or run manually later.

1. Run \`kido docs export --to <this-repo>\` first (or confirm it's already been run) — this literally copies the legacy repo's two docs files in as a starting point.
2. Then run Mode 2's interview (or Mode 1 if there's already some code here too), but **seeded with the copied legacy docs as reference material** — ask the user, section by section, what carries over unchanged (business rules usually do) vs. what needs rewriting for the new stack (architecture specifics usually don't). A human stays in the loop on what survives; don't silently strip or keep anything.
3. Emit the adapted \`functional-docs.md\`/\`technical-docs.md\` for *this* repo — the copied legacy files were just a seed, not the final output.

## Interaction with the rest of the pipeline

\`kido/docs/\` is OWNED by this skill. Every other stage (\`/kido:spec\`, \`/kido:tasks\`, \`/kido:apply\`, \`/kido:review\`) reads it for context but never writes to it directly. When \`/kido:archive\` asks "update /docs?" and the user says yes, it re-invokes *this same skill* in a scoped, incremental mode — fed the change's own artifacts (functional-spec.md/design.md/tasks.md/bug.md + the actual diff) as extra grounding alongside re-reading just the affected code area. One mechanism for every \`/docs\` write, not three that could drift apart.

## Guardrails

- Never fabricate what you can't verify or weren't told — mark it as an open question instead.
- Don't overwrite sections that are already well-grounded just because you're re-running — merge/update, don't blow away.
- Bug fixes (see \`/kido:spec\`) don't get a functional-spec.md, but their \`bug.md\` should still feed into a features-level note here if the bug reveals a real gap in previously-documented behavior.
`;

export const studyStage: PipelineStage = {
  id: "study",
  description:
    "Build or refresh kido/docs/ (functional-docs.md + technical-docs.md) — brownfield code discovery, greenfield interview, or cross-repo regeneration. Use before any spec work on a repo with no /docs yet, or to keep /docs current.",
  allowedTools: "Bash(kido:*), Read, Grep, Glob, Write, Edit",
  body,
};
