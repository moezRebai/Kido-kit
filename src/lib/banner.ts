// ANSI color for the `kido init` welcome banner. No color library — this
// project has zero runtime dependencies and that should stay true.
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";

interface BannerRow {
  /** Left column: part of the robot glyph for this row, or spaces if the robot doesn't extend this far. */
  robot: string;
  text: string;
  bold?: boolean;
}

// Robot glyph column is a fixed 13-char field so every row lines up;
// each glyph is centered within it.
const BLANK_ROBOT = " ".repeat(13);

const ROWS: BannerRow[] = [
  { robot: "      o      ", text: "" },
  { robot: "      |      ", text: "" },
  { robot: "    #####    ", text: "Welcome to Kido", bold: true },
  { robot: "    #o#o#    ", text: "Spec-driven BA/Dev collaboration for microservices" },
  { robot: "    #####    ", text: "" },
  { robot: "     # #     ", text: "This setup will configure:" },
  { robot: "    ## ##    ", text: "  - kido/docs/ + kido/changes/ scaffolding" },
  { robot: BLANK_ROBOT, text: "  - Claude Code skills/commands under .claude/" },
  { robot: BLANK_ROBOT, text: "" },
  { robot: BLANK_ROBOT, text: "Quick start after setup:" },
  { robot: BLANK_ROBOT, text: "  /kido:specify  ->  /kido:apply  ->  /kido:archive" },
  { robot: BLANK_ROBOT, text: "" },
  { robot: BLANK_ROBOT, text: "Setting up..." },
];

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

export function printWelcomeBanner(): void {
  const color = supportsColor();
  console.log();
  for (const row of ROWS) {
    const robot = color ? `${CYAN}${row.robot}${RESET}` : row.robot;
    const text = color && row.bold ? `${BOLD}${row.text}${RESET}` : row.text;
    console.log(`${robot}  ${text}`.trimEnd());
  }
  console.log();
}
