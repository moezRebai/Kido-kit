# 01 — Glossary

| Term | Definition |
|---|---|
| **Adapter** | Code that installs canonical TeamFlow skills, rules and plugins for a specific coding agent (Kilo Code in the MVP). See [03](03-agent-adapters.md). |
| **Agent (TeamFlow agent)** | An on-demand quality or analysis skill (`tf-agent-*`), e.g. SonarQube results, sanity check. Never triggered automatically by a workflow. See [08](08-agents-and-checks.md). Not to be confused with the *coding agent*. |
| **Agent group** | A named set of agents run together, e.g. `pre-pr`. |
| **Archive** | Final phase of a topic: commit, pull request, documentation refresh, move of the topic folder to `teamflow/changes/archive/`. |
| **Brick** | A skill shared by both journeys: `tf-review`, `tf-archive`, `tf-document`, `tf-architecture`. |
| **Check report** | The standardized result file an agent writes: `teamflow/changes/<topic>/checks/<agent-id>.md`. |
| **Checklist** | A list of questions grooming MUST cover (e.g. security, GDPR, data migration). Customizable. |
| **Coding agent** | The AI tool the user works in: Kilo Code (MVP), later Claude Code, Gemini CLI. |
| **Config** | `teamflow/config.yml` in a target repository. See [07](07-customization.md). |
| **Enforced pack** | A pack the organization policy installs everywhere and forbids removing. |
| **Gate** | A human validation point between phases (e.g. *spec approved*). Recorded in `state.md`. |
| **Grooming** | The interview that turns a request into a clear need: one question at a time, options with trade-offs, edge cases. |
| **Hub** | TeamFlow Hub, the web app for catalog, statistics and governance (phases 2–4). |
| **Index** | `index.json` in Artifactory release: the catalog of published pack versions. |
| **Invariant** | A rule that customization cannot change (e.g. TDD proof, gates, file layout). |
| **Journey** | A path through the workflow for a kind of request: feature, bug, documentation, explanation, rebuild, agents, add a capability. |
| **Layer** | One level of the customization resolution order: repo overrides > org overrides > installed packs > core. |
| **Lockfile** | `teamflow/packs.lock`, committed: exact pack versions and checksums used by a repository. |
| **Marketplace** | The `teamflow-marketplace` source repository plus its Jenkins pipeline and Artifactory repositories. |
| **Mode** | `solo` (one person, no Jira handoff) or `team` (handoff through Jira). Chosen after the spec is approved. |
| **Org policy** | The `org-policy` pack: allowed sources, trust levels, enforced packs, minimum versions, telemetry setting. |
| **Override** | A file in `teamflow/overrides/` (or the org overrides folder) that replaces a default template, checklist or agent definition. |
| **Pack** | The unit of distribution: a versioned archive containing skills, references, scripts and a manifest `teamflow-pack.yml`. |
| **Phase** | The current step of a topic: `groom`, `spec`, `architecture`, `plan`, `implement`, `ship`, `archived`. |
| **Reference** | A Markdown file inside a skill (`references/`) that the skill reads on demand: method, template, checklist. |
| **Router** | The `teamflow` skill: reads the request and context, then invokes the right skill or agent, or asks one question. |
| **Rule (Kilo rule)** | Permanent instruction loaded in every Kilo session telling the agent to use the router. |
| **Script** | A bundled Node.js file inside a skill (`scripts/`) for deterministic work. |
| **SDD** | Spec-driven development: no code before a validated spec. |
| **Skill** | A folder with `SKILL.md` (instructions + metadata), optional `references/` and `scripts/`. The coding agent loads it when the request matches its description or when invoked explicitly. |
| **Spec type** | A kind of spec with its own template, checklists and rules: `feature`, `bug`, `rebuild`, or custom (e.g. `api-contract`). |
| **State** | `teamflow/changes/<topic>/state.md`: phase, mode, decisions, tasks, gates, waivers, check results. |
| **Topic** | One unit of work (a feature, a bug, a rebuild program) with its folder `teamflow/changes/<topic>/`. |
| **Trust level** | `official`, `org` or `community`; determines review and whether a pack may contain scripts. |
| **Waiver** | A recorded, justified exception to a non-enforced check before shipping. |
