import type { PipelineStage } from "../pipeline/definition.js";

export function buildAskStage(otherStages: PipelineStage[]): PipelineStage {
  const commandRows = otherStages
    .map((stage) => `| /kido:${stage.id} | ${stage.description.replaceAll("|", "\\|")} |`)
    .join("\n");

  const body = `You don't need to remember every /kido: command — ask.

## Commands

| Command | What it does |
|---|---|
${commandRows}

## Answering "what should I use for X?"

Match the user's situation against the table above — the descriptions already encode each command's fork points and hand-offs to the next command. Ask a clarifying question if the situation is genuinely ambiguous (e.g. bug vs. feature) rather than guessing.

## Answering "what does X do in detail?"

The table's one-liner is a summary, not the full story. Read \`.claude/commands/kido/<id>.md\` for the complete orchestration body before answering an "explain X in detail" question.

## Guardrails

- Never inspect \`kido/changes/\` or Jira state — that's \`/kido:continue\`'s job for a specific in-flight change. If the question is really "what's next for MY change" rather than "what does this command do in general," redirect there instead of guessing from this table alone.
- Don't invent behavior beyond what the table or the full command file actually says.
`;

  return {
    id: "ask",
    description:
      "Reference/router: answers \"what does /kido:X do\" and \"which command fits my situation\" from a live-generated table of every other command. Stateless — never reads kido/changes/ or Jira; redirects to /kido:continue for a specific in-flight change's status.",
    allowedTools: "Read",
    body,
  };
}
