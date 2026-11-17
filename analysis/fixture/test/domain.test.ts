import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, parse } from "../src/domain.ts";

test("grade", () => {
  assert.equal(grade(1), "a");
});

test("parse", () => {
  assert.deepEqual(parse("[1]"), [1]);
});
