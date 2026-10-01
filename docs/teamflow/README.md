# TeamFlow — Specification set

> **Status:** Draft v0.1 — awaiting product-owner validation
> **Target:** MVP for **Kilo Code**, designed to extend to other coding agents (Claude Code, Gemini CLI, …)
> **Language:** specifications are written in English; TeamFlow's conversations with users follow the user's language.

TeamFlow is a **spec-driven development (SDD) toolkit for coding agents**. It is delivered entirely as
agent **skills** (instructions + references + scripts), routed by a single entry skill, and distributed
to teams as versioned **packs** through an internal **marketplace**. It supports a solo path (one person,
from need to merged code, in one session) and a team path (BA → Dev handoff through Jira), plus
on-demand quality agents (SonarQube, Checkmarx, sanity checks…).

This folder is **self-contained**: a reader (human or agent) starting from a fresh session or another
machine must be able to understand and implement TeamFlow from these files alone.

## Reading order

| # | File | What it answers |
|---|---|---|
| 00 | [Vision and scope](00-vision-and-scope.md) | Why TeamFlow exists, who uses it, what the MVP includes and excludes |
| 01 | [Glossary](01-glossary.md) | Every TeamFlow term, defined once |
| 02 | [Architecture](02-architecture.md) | Layers, components, routing, repository layout, invariants |
| 03 | [Coding-agent adapters](03-agent-adapters.md) | How TeamFlow targets Kilo Code now and other agents later |
| 04 | [User journeys](04-user-journeys.md) | Feature, bug, documentation, code explanation, legacy rebuild, agents, adding a capability |
| 05 | [Skills catalog](05-skills-catalog.md) | Every skill: role, trigger, inputs, outputs, side effects, acceptance criteria |
| 06 | [Artifacts and state](06-artifacts-and-state.md) | `state.md`, phase state machine, templates, check reports, lockfile |
| 07 | [Customization](07-customization.md) | `config.yml`, overrides, checklists, spec types, resolution order |
| 08 | [Agents and checks](08-agents-and-checks.md) | On-demand quality agents, groups, result format, ship verification |
| 09 | [Atlassian integrations](09-atlassian-integrations.md) | Jira, Bitbucket and Confluence Data Center via scripts |
| 10 | [Marketplace and packs](10-marketplace-and-packs.md) | Pack format, Bitbucket DC + Jenkins + Artifactory pipeline, `tf-packs`, bootstrap |
| 11 | [Hub and telemetry](11-hub-and-telemetry.md) | Web app and usage statistics (phases 2–3, not in MVP) |
| 12 | [Reusable code](12-reusable-code.md) | Existing TypeScript modules in this repository to reuse as script foundations |
| 13 | [MVP plan](13-mvp-plan.md) | Ordered work packages, acceptance criteria, test strategy |
| 14 | [Decisions and open questions](14-decisions-and-open-questions.md) | Decision log (ADR-style) and what is still to be decided |
| 15 | [Non-functional requirements](15-non-functional.md) | Security, privacy, performance, portability, reliability |

### Diagrams

Open these files directly in a browser (no network needed except web fonts, which degrade gracefully):

| File | Shows |
|---|---|
| [diagrams/architecture.html](diagrams/architecture.html) | Components and flows, SDD workflow, on-demand agents, customization layers |
| [diagrams/getting-started.html](diagrams/getting-started.html) | Beginner guide: TeamFlow in six requests |
| [diagrams/marketplace.html](diagrams/marketplace.html) | Pack lifecycle: Bitbucket DC → Jenkins → Artifactory → developer workstations, plus the Hub |
| [diagrams/state-machine.html](diagrams/state-machine.html) | Topic phases and the gates between them |

Each Markdown file also embeds its key diagrams as Mermaid blocks so they render in Bitbucket, IDEs and
plain-text readers.

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** follow RFC 2119 meanings.
- `code` formatting marks file names, skill names, commands and configuration keys.
- A **(verify)** tag marks a statement about Kilo Code or a third-party product that must be confirmed
  against current vendor documentation before implementation. All such items are also tracked in
  [14-decisions-and-open-questions.md](14-decisions-and-open-questions.md).
- Paths starting with `teamflow/` are inside a **target repository** (a team's application repo).
  Paths starting with `src/` are inside **this** repository (the TeamFlow source).
- Placeholders are written `<like-this>`.

## How to resume work in a new session

1. Read this README, then `00`, `02` and `13`.
2. Check `14` for decisions made since the last session and for open questions.
3. Pick the next work package in `13` whose dependencies are done; its acceptance criteria are the
   definition of done.
4. Record any new decision in `14` before implementing it.
