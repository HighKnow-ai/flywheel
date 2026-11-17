import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { testTimeScale } from "./time-scale.mjs";

const saved = process.env.FLYWHEEL_TEST_TIME_SCALE;

afterEach(() => {
  if (saved === undefined) delete process.env.FLYWHEEL_TEST_TIME_SCALE;
  else process.env.FLYWHEEL_TEST_TIME_SCALE = saved;
});

test("testTimeScale is the variable's positive number, and 1 for anything else", () => {
  for (const [value, expected] of [
    [undefined, 1],
    ["", 1],
    ["3", 3],
    ["2.5", 2.5],
    ["0", 1],
    ["-2", 1],
    ["slow", 1],
    ["Infinity", 1],
  ]) {
    if (value === undefined) delete process.env.FLYWHEEL_TEST_TIME_SCALE;
    else process.env.FLYWHEEL_TEST_TIME_SCALE = value;
    assert.equal(testTimeScale(), expected, `FLYWHEEL_TEST_TIME_SCALE=${JSON.stringify(value)}`);
  }
});
