// Minimal hand-rolled CLI argument parser — deliberately not a dependency
// (commander/yargs) since the whole surface is ~6-8 subcommands with a
// handful of flags each. See plan-SDD-kido.md's dependency-minimization goal.

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parses `kido <command> [...positionals] [--flag value] [--bool]`.
 * Deliberately doesn't guess at "subcommands" — a two-level command like
 * `docs export` or `jira sync` is just `command="docs"` with
 * `positionals[0]="export"`; the caller (cli.ts) decides what that means.
 * This keeps `new-change <name>` and `archive <name>` unambiguous: their
 * first token is always a plain positional, never mistaken for a subcommand.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

export function requireFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name} <value>`);
  }
  return value;
}

export function optionalFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
