import { parseArgs, requireFlag, optionalFlag } from "./lib/args.js";
import { findRepoRoot } from "./lib/kido-paths.js";
import { runInit } from "./commands/init.js";
import { runNewChange } from "./commands/new-change.js";
import { runStatus } from "./commands/status.js";
import { runValidate } from "./commands/validate.js";
import { runArchive } from "./commands/archive.js";
import { runDocsExport } from "./commands/docs-export.js";
import { runJiraSync } from "./commands/jira-sync.js";
import type { ChangeType } from "./lib/change-meta.js";

const HELP = `kido — spec-driven BA/Dev collaboration CLI

Usage:
  kido --version                            Print the installed version
  kido init [--from-legacy <path> | --no-legacy] [--skip-jira-setup]  Scaffold kido/ and generate Claude Code skills/commands
  kido new-change <name> [--type feature|bug]  Create a new change (default: feature)
  kido status --change <name>               Show artifact completion for a change
  kido validate --change <name>             Check a change is ready to archive
  kido archive <name> [--force]             Move a change to kido/changes/archive/
  kido docs export --to <path>              Copy kido/docs/ into another repo
  kido jira sync --change <name> [--epic <KEY>]  Push change artifacts to Jira (--epic pins Stories to an existing Epic)
`;

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  if (command === "--version" || command === "-v") {
    console.log(__KIDO_VERSION__);
    return;
  }

  const repoRoot = findRepoRoot(process.cwd());

  switch (command) {
    case "init":
      await runInit(repoRoot, {
        ...(typeof flags["from-legacy"] === "string" ? { fromLegacy: flags["from-legacy"] } : {}),
        noLegacy: Boolean(flags["no-legacy"]),
        skipJiraSetup: Boolean(flags["skip-jira-setup"]),
      });
      break;

    case "new-change": {
      const name = positionals[0];
      if (!name) throw new Error("Usage: kido new-change <name> [--type feature|bug]");
      const type = (optionalFlag(flags, "type") ?? "feature") as ChangeType;
      runNewChange(repoRoot, name, type);
      break;
    }

    case "status":
      runStatus(repoRoot, requireFlag(flags, "change"));
      break;

    case "validate":
      runValidate(repoRoot, requireFlag(flags, "change"));
      break;

    case "archive": {
      const name = positionals[0];
      if (!name) throw new Error("Usage: kido archive <name> [--force]");
      runArchive(repoRoot, name, Boolean(flags.force));
      break;
    }

    case "docs":
      if (positionals[0] === "export") {
        runDocsExport(repoRoot, requireFlag(flags, "to"));
      } else {
        console.log(HELP);
      }
      break;

    case "jira":
      if (positionals[0] === "sync") {
        await runJiraSync(repoRoot, requireFlag(flags, "change"), optionalFlag(flags, "epic"));
      } else {
        console.log(HELP);
      }
      break;

    default:
      console.log(HELP);
      break;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
