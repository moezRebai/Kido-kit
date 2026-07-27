import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderCheckboxList,
  keyToCheckboxAction,
  applyCheckboxAction,
  type CheckboxChoice,
  type CheckboxState,
} from "../src/lib/checkbox.js";

const choices: CheckboxChoice<"a" | "b" | "c">[] = [
  { id: "a", label: "Option A" },
  { id: "b", label: "Option B" },
  { id: "c", label: "Option C" },
];

test("renderCheckboxList marks the selected choices and the cursor row", () => {
  const output = renderCheckboxList("Pick some:", choices, new Set(["b"]), 1);
  const lines = output.split("\n");
  assert.equal(lines[0], "Pick some:");
  assert.equal(lines[1], "  [ ] Option A");
  assert.equal(lines[2], "> [x] Option B");
  assert.equal(lines[3], "  [ ] Option C");
});

test("keyToCheckboxAction maps arrow keys, space, enter, and ctrl+c", () => {
  assert.equal(keyToCheckboxAction({ name: "up" }), "up");
  assert.equal(keyToCheckboxAction({ name: "down" }), "down");
  assert.equal(keyToCheckboxAction({ name: "space", sequence: " " }), "toggle");
  assert.equal(keyToCheckboxAction({ name: "return" }), "confirm");
  assert.equal(keyToCheckboxAction({ name: "c", ctrl: true }), "cancel");
  assert.equal(keyToCheckboxAction({ name: "a" }), undefined);
  assert.equal(keyToCheckboxAction(undefined), undefined);
});

test("applyCheckboxAction moves the cursor with wraparound and toggles selection", () => {
  const state: CheckboxState<"a" | "b" | "c"> = { cursorIndex: 0, selected: new Set() };

  const movedUp = applyCheckboxAction(state, "up", choices);
  assert.equal(movedUp.cursorIndex, 2, "up from index 0 should wrap to the last choice");

  const movedDown = applyCheckboxAction(state, "down", choices);
  assert.equal(movedDown.cursorIndex, 1);

  const toggled = applyCheckboxAction(state, "toggle", choices);
  assert.deepEqual([...toggled.selected], ["a"]);

  const toggledAgain = applyCheckboxAction(toggled, "toggle", choices);
  assert.deepEqual([...toggledAgain.selected], []);
});
