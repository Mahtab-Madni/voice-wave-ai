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

test("normalizeActionPlan backfills the top-level action from a wrapped plan", () => {
  const normalized = normalizeActionPlan({
    plan: [
      {
        action: "CLICK",
        target: "#cart-button",
        confidence: 0.9,
        reasoning: "Open the cart first.",
      },
      {
        action: "NAVIGATE",
        value: "/checkout",
        confidence: 0.86,
        reasoning: "Continue to the payment page.",
      },
    ],
  });

  assert.equal(normalized.action, "CLICK");
  assert.equal(normalized.plan.length, 2);
  assert.equal(normalized.plan[0].action, "CLICK");
  assert.equal(normalized.plan[1].action, "NAVIGATE");
});
