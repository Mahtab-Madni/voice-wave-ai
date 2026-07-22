import test from "node:test";
import assert from "node:assert/strict";
import { normalizeActionPlan } from "../server/voice/planner.js";

test("normalizeActionPlan accepts RESPOND and preserves message", () => {
  const normalized = normalizeActionPlan({
    action: "RESPOND",
    message: "This form asks for Name and Email.",
    confidence: 0.72,
  });

  assert.equal(normalized.action, "RESPOND");
  assert.equal(normalized.message, "This form asks for Name and Email.");
  assert.equal(normalized.confidence, 0.72);
});
