import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Minimal interactive prompt session — no inquirer/prompts dependency.
 * Uses ONE readline interface for the whole session: creating and closing a
 * separate interface per question is unreliable against piped (non-TTY)
 * stdin, since the next interface doesn't reliably see already-buffered input.
 */
export class PromptSession {
  private readonly rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: stdin, output: stdout });
  }

  async askYesNo(question: string, defaultYes = false): Promise<boolean> {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = (await this.rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
  }

  async askText(question: string): Promise<string> {
    return (await this.rl.question(`${question} `)).trim();
  }

  close(): void {
    this.rl.close();
  }
}
