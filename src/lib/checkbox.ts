export interface CheckboxChoice<T extends string> {
  id: T;
  label: string;
}

export interface CheckboxState<T extends string> {
  cursorIndex: number;
  selected: Set<T>;
}

export type CheckboxAction = "up" | "down" | "toggle" | "confirm" | "cancel";

export interface Keypress {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

/** Renders the current checkbox state as the multi-line text to print to the terminal. */
export function renderCheckboxList<T extends string>(
  question: string,
  choices: CheckboxChoice<T>[],
  selected: ReadonlySet<T>,
  cursorIndex: number
): string {
  const lines = [question];
  choices.forEach((choice, i) => {
    const box = selected.has(choice.id) ? "[x]" : "[ ]";
    const cursor = i === cursorIndex ? ">" : " ";
    lines.push(`${cursor} ${box} ${choice.label}`);
  });
  return lines.join("\n");
}

/** Maps a Node readline keypress event to a checkbox action, or undefined for keys we ignore. */
export function keyToCheckboxAction(key: Keypress | undefined): CheckboxAction | undefined {
  if (!key) return undefined;
  if (key.ctrl && key.name === "c") return "cancel";
  if (key.name === "up") return "up";
  if (key.name === "down") return "down";
  if (key.name === "return") return "confirm";
  if (key.name === "space" || key.sequence === " ") return "toggle";
  return undefined;
}

/** Pure state transition: applies one action to the current checkbox state. */
export function applyCheckboxAction<T extends string>(
  state: CheckboxState<T>,
  action: CheckboxAction,
  choices: CheckboxChoice<T>[]
): CheckboxState<T> {
  const selected = new Set(state.selected);
  let cursorIndex = state.cursorIndex;

  if (action === "up") cursorIndex = (cursorIndex - 1 + choices.length) % choices.length;
  if (action === "down") cursorIndex = (cursorIndex + 1) % choices.length;
  if (action === "toggle") {
    const id = choices[cursorIndex]!.id;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  return { cursorIndex, selected };
}
