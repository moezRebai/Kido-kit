import type { PipelineStage } from "../pipeline/definition.js";

const body = `Build or refresh \`kido/docs/\` — the single source of truth every other Kido stage reads from — from an existing codebase. Brownfield only: if there's no real code here yet, this isn't the right command (see \`/kido:specify\`, which builds \`kido/docs/\` inline as part of its own session for genuinely greenfield projects).

Also the command to run any time \`kido/docs/\` needs refreshing — after \`/kido:archive\` asks to update docs, or manually whenever the docs feel stale relative to the code.

**Store selection:** resolve the repo root by walking up for a \`kido/\` folder (or \`.git\` as a fallback anchor). Everything below is scoped to that root's \`kido/docs/{project}-functional-docs.md\` and \`kido/docs/{project}-technical-docs.md\`.

---

## Discovery process

Adapt the project's existing \`discover-and-document\` skill approach as-is — it already does exactly this:

1. **Inventory** — cheap, breadth-first: file tree, stack detection, entry points, existing docs (treat as claims to verify, not truth), repo size → strategy.
2. **Map** — module/component graph, dependency edges, data model, and a deliberate pass over three first-class surface kinds: API surface (request/response), real-time/streaming channels, service topology (discovery & routing).
3. **Deep-dive** — trace 2-4 critical flows end-to-end across module boundaries, extract business rules, spot where names lie about behavior.
4. **Synthesize** — reconcile map vs. reality, reverse-engineer ADRs (mark them explicitly "inferred — please review"), run a verify-before-emit loop.
5. **Emit** — write \`{project}-functional-docs.md\` (capability inventory, use cases/user journeys, business rules, domain glossary, scope/assumptions) and \`{project}-technical-docs.md\` (C4 diagrams, component reference, data model, sequence diagrams, ADRs, cross-cutting concerns, build/run notes). Diagrams inline as Mermaid, not separate files.

**Ground everything.** Every non-trivial claim cites a real file/symbol. Anything unverifiable goes to a "Confidence & open questions" section — never asserted as fact.

## Refreshing existing docs

Same process, but incremental:

- **Scoping:** if invoked for a specific area (e.g. from an archive-time refresh, or a manual targeted re-run), don't re-scan the whole repo — focus the Map/Deep-dive passes on the affected area, but still validate against the rest for consistency.
- **Don't overwrite sections that are already well-grounded** just because you're re-running — merge/update, don't blow away.
- If re-invoked from \`/kido:archive\`'s "update /docs?" step, you'll be fed the change's own artifacts (\`functional-spec.md\`/\`design.md\`/\`tasks.md\`/\`bug.md\` + the actual diff) as extra grounding alongside re-reading just the affected code area.

## Interaction with the rest of the pipeline

\`kido/docs/\` is OWNED by this skill for existing-code projects. Every other stage (\`/kido:specify\`, \`/kido:tasks\`, \`/kido:apply\`, \`/kido:review\`) reads it for context but never writes to it directly. When \`/kido:archive\` asks "update /docs?" and the user says yes, it re-invokes *this same skill* in the scoped, incremental mode described above — one mechanism for every existing-project \`/docs\` write, not several that could drift apart.

## Guardrails

- Never fabricate what you can't verify or weren't told — mark it as an open question instead.
- Don't overwrite sections that are already well-grounded just because you're re-running — merge/update, don't blow away.
- Bug fixes (see \`/kido:specify\`) don't get a functional-spec.md, but their \`bug.md\` should still feed into a features-level note here if the bug reveals a real gap in previously-documented behavior.
`;

export const documentStage: PipelineStage = {
  id: "document",
  description:
    "Build or refresh kido/docs/ (functional-docs.md + technical-docs.md) from an existing codebase — brownfield discovery only. For a project with no code yet, /kido:specify builds docs as part of its own session instead.",
  allowedTools: "Bash(kido:*), Read, Grep, Glob, Write, Edit",
  body,
};
