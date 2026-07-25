import test from "node:test";
import assert from "node:assert/strict";
import {
  createKeyRotator,
  normalizeApiKeys,
  resolveRotatedApiKey,
} from "../apiKeyRotator.js";

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

test("resolveRotatedApiKey resolves from options and rotates across values", () => {
  const state = {};
  const first = resolveRotatedApiKey(
    "GROQ_API_KEY",
    {
      GROQ_API_KEY: "key-1, key-2",
    },
    state,
  );
  const second = resolveRotatedApiKey("GROQ_API_KEY", {}, state);

  assert.equal(first, "key-1");
  assert.equal(second, "key-2");
});

test("buildActionPlan rejects planning when no Groq key is available", async () => {
  const { buildActionPlan } = await import("../server/voice/planner.js");
  await assert.rejects(
    () => buildActionPlan("click the cart button", [], { groqApiKey: "" }),
    /GROQ API key is required for LLM planning/,
  );
});
