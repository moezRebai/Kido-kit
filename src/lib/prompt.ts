import * as readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  renderCheckboxList,
  keyToCheckboxAction,
  applyCheckboxAction,
  type CheckboxChoice,
  type CheckboxState,
  type Keypress,
} from "./checkbox.js";

/**
 * Minimal interactive prompt session — no inquirer/prompts dependency.
 * Uses ONE readline interface for the whole session: creating and closing a
 * separate interface per question is unreliable against piped (non-TTY)
 * stdin, since the next interface doesn't reliably see already-buffered input.
 */
export class PromptSession {
  private rl: readline.Interface;

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

  async askCheckbox<T extends string>(
    question: string,
    choices: CheckboxChoice<T>[],
    defaultSelected: T[]
  ): Promise<T[]> {
    // readline's own Interface attaches its own 'keypress' listener to stdin
    // (for line-editing/history) as soon as it's constructed. If it stayed
    // attached while we read raw single keys below, both listeners would
    // react to the same keypress and corrupt the terminal. Closing it here
    // detaches that listener; a fresh Interface is created in `finally` so
    // askYesNo/askText keep working on any later call.
    this.rl.close();

    let state: CheckboxState<T> = { cursorIndex: 0, selected: new Set(defaultSelected) };
    const render = () => renderCheckboxList(question, choices, state.selected, state.cursorIndex);
    const linesDrawn = choices.length + 1;

    stdout.write(render() + "\n");

    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw ?? false;
    if (stdin.setRawMode) stdin.setRawMode(true);

    try {
      return await new Promise<T[]>((resolve) => {
        const onKeypress = (_str: string, key: Keypress) => {
          const action = keyToCheckboxAction(key);
          if (!action) return;
          if (action === "cancel" || action === "confirm") {
            stdin.off("keypress", onKeypress);
            resolve([...state.selected]);
            return;
          }
          state = applyCheckboxAction(state, action, choices);
          stdout.write(`\x1B[${linesDrawn}A`);
          for (let i = 0; i < linesDrawn; i++) stdout.write("\x1B[2K\n");
          stdout.write(`\x1B[${linesDrawn}A`);
          stdout.write(render() + "\n");
        };
        stdin.on("keypress", onKeypress);
      });
    } finally {
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      this.rl = readline.createInterface({ input: stdin, output: stdout });
    }
  }

  close(): void {
    this.rl.close();
  }
}
