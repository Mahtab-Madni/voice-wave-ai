import test from "node:test";
import assert from "node:assert/strict";
import { createKeyRotator, normalizeApiKeys } from "../apiKeyRotator.js";

test("normalizeApiKeys trims and splits comma-separated values", () => {
  assert.deepEqual(normalizeApiKeys(" key-1 , key-2 , key-3 "), [
    "key-1",
    "key-2",
    "key-3",
  ]);
});

test("createKeyRotator returns keys in round-robin order", () => {
  const getNextKey = createKeyRotator(["key-1", "key-2", "key-3"]);

  assert.equal(getNextKey(), "key-1");
  assert.equal(getNextKey(), "key-2");
  assert.equal(getNextKey(), "key-3");
  assert.equal(getNextKey(), "key-1");
});
