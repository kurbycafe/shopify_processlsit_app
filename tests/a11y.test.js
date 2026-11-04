import test from "node:test";
import assert from "node:assert/strict";
import { pressable } from "../app/utils/a11y.js";

test("pressable activates on Enter/Space and ignores keys from nested buttons", () => {
  let calls = 0;
  const props = pressable(() => calls++);
  assert.equal(props.role, "button");
  assert.equal(props.tabIndex, 0);
  const self = {};
  const key = (k, target = self) => props.onKeyDown({ key: k, target, currentTarget: self, preventDefault() {} });
  key("Enter");
  key(" ");
  key("a");
  key("Enter", {});
  assert.equal(calls, 2);
  assert.deepEqual(pressable(null), {});
});
